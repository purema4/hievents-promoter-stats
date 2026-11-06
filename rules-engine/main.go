// The rules engine: checks and evaluates promoter rules written in CEL (Common Expression Language).
//
// Only promoter-stats talks to it, on the Docker network; it has no public port. It never runs code
// sent to it: CEL has no loops, no I/O and no access to anything but the variables it is given, and
// every evaluation is limited in size, cost and time.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"cel.dev/cel-go/cel"
	"cel.dev/cel-go/common/ast"
	"cel.dev/cel-go/common/types"
	"cel.dev/cel-go/common/types/ref"
)

// Limits. A rule is a few short lines; anything far bigger is a mistake or an attack.
const (
	maxExpressions   = 50
	maxExpressionLen = 1000
	maxVariables     = 100
	maxInputs        = 5000
	maxBodyBytes     = 4 << 20
	costLimit        = 10_000 // per expression and evaluation; a normal rule costs well under 100
	requestTimeout   = 5 * time.Second
	maxCachedProgs   = 2000
)

type variable struct {
	Name string `json:"name"`
	Type string `json:"type"` // number, string or bool
}

type issue struct {
	Message string `json:"message"`
	Column  int    `json:"column"` // 0-based, within the expression
}

// --- Environment -----------------------------------------------------------------------------

func celType(t string) (*cel.Type, error) {
	switch t {
	case "number":
		return cel.DoubleType, nil
	case "string":
		return cel.StringType, nil
	case "bool":
		return cel.BoolType, nil
	}
	return nil, fmt.Errorf("unknown variable type %q", t)
}

func unary(f func(float64) float64) cel.OverloadOpt {
	return cel.UnaryBinding(func(v ref.Val) ref.Val { return types.Double(f(float64(v.(types.Double)))) })
}

// floor, ceil, round, min and max, on numbers (doubles).
var helpers = []cel.EnvOption{
	cel.Function("floor", cel.Overload("floor_double", []*cel.Type{cel.DoubleType}, cel.DoubleType, unary(math.Floor))),
	cel.Function("ceil", cel.Overload("ceil_double", []*cel.Type{cel.DoubleType}, cel.DoubleType, unary(math.Ceil))),
	// Half away from zero, like Math.round on positive amounts.
	cel.Function("round", cel.Overload("round_double", []*cel.Type{cel.DoubleType}, cel.DoubleType, unary(math.Round))),
	cel.Function("min",
		cel.Overload("min_double_double", []*cel.Type{cel.DoubleType, cel.DoubleType}, cel.DoubleType,
			cel.BinaryBinding(func(a, b ref.Val) ref.Val {
				return types.Double(math.Min(float64(a.(types.Double)), float64(b.(types.Double))))
			})),
		cel.Overload("min_double_double_double", []*cel.Type{cel.DoubleType, cel.DoubleType, cel.DoubleType}, cel.DoubleType,
			cel.FunctionBinding(func(v ...ref.Val) ref.Val {
				return types.Double(math.Min(float64(v[0].(types.Double)), math.Min(float64(v[1].(types.Double)), float64(v[2].(types.Double)))))
			}))),
	cel.Function("max",
		cel.Overload("max_double_double", []*cel.Type{cel.DoubleType, cel.DoubleType}, cel.DoubleType,
			cel.BinaryBinding(func(a, b ref.Val) ref.Val {
				return types.Double(math.Max(float64(a.(types.Double)), float64(b.(types.Double))))
			})),
		cel.Overload("max_double_double_double", []*cel.Type{cel.DoubleType, cel.DoubleType, cel.DoubleType}, cel.DoubleType,
			cel.FunctionBinding(func(v ...ref.Val) ref.Val {
				return types.Double(math.Max(float64(v[0].(types.Double)), math.Max(float64(v[1].(types.Double)), float64(v[2].(types.Double)))))
			}))),
}

func newEnv(vars []variable) (*cel.Env, error) {
	if len(vars) > maxVariables {
		return nil, errors.New("too many variables")
	}
	opts := append([]cel.EnvOption{}, helpers...)
	for _, v := range vars {
		t, err := celType(v.Type)
		if err != nil {
			return nil, err
		}
		opts = append(opts, cel.Variable(v.Name, t))
	}
	return cel.NewEnv(opts...)
}

// Every number written in a rule becomes a double, so 75 and 75.0 mean the same and mix with the
// variables (all numbers are doubles). CEL alone keeps int and double apart.
func numbersAsDoubles(parsed *cel.Ast) {
	fac := ast.NewExprFactory()
	ast.PostOrderVisit(parsed.NativeRep().Expr(), ast.NewExprVisitor(func(e ast.Expr) {
		if e.Kind() != ast.LiteralKind {
			return
		}
		switch v := e.AsLiteral().(type) {
		case types.Int:
			e.SetKindCase(fac.NewLiteral(e.ID(), types.Double(float64(v))))
		case types.Uint:
			e.SetKindCase(fac.NewLiteral(e.ID(), types.Double(float64(v))))
		}
	}))
}

func issues(iss *cel.Issues) []issue {
	var out []issue
	for _, e := range iss.Errors() {
		out = append(out, issue{Message: e.Message, Column: max(0, e.Location.Column())})
	}
	if len(out) == 0 && iss.Err() != nil {
		out = append(out, issue{Message: iss.Err().Error()})
	}
	return out
}

// compile parses, converts numbers and type-checks one expression. The result must be a number.
func compile(env *cel.Env, expr string) (*cel.Ast, []issue) {
	if strings.TrimSpace(expr) == "" {
		return nil, []issue{{Message: "the expression is empty"}}
	}
	if len(expr) > maxExpressionLen {
		return nil, []issue{{Message: fmt.Sprintf("the expression is longer than %d characters", maxExpressionLen)}}
	}
	parsed, iss := env.Parse(expr)
	if iss != nil && iss.Err() != nil {
		return nil, issues(iss)
	}
	numbersAsDoubles(parsed)
	checked, iss := env.Check(parsed)
	if iss != nil && iss.Err() != nil {
		return nil, issues(iss)
	}
	if t := checked.OutputType(); !t.IsExactType(cel.DoubleType) && !t.IsExactType(cel.IntType) {
		return nil, []issue{{Message: fmt.Sprintf("the result must be a number, not %s", t.String())}}
	}
	return checked, nil
}

// --- The parsed tree, for the app to put rules into words ----------------------------------------

type node struct {
	Kind string  `json:"k"`           // num, str, bool, var, call, other
	Num  float64 `json:"v,omitempty"` // num
	Str  string  `json:"s,omitempty"` // str, var (name), call (function)
	Bool bool    `json:"b,omitempty"` // bool
	Args []node  `json:"a,omitempty"` // call
}

func tree(e ast.Expr) node {
	switch e.Kind() {
	case ast.LiteralKind:
		switch v := e.AsLiteral().(type) {
		case types.Double:
			return node{Kind: "num", Num: float64(v)}
		case types.Int:
			return node{Kind: "num", Num: float64(v)}
		case types.Uint:
			return node{Kind: "num", Num: float64(v)}
		case types.String:
			return node{Kind: "str", Str: string(v)}
		case types.Bool:
			return node{Kind: "bool", Bool: bool(v)}
		}
	case ast.IdentKind:
		return node{Kind: "var", Str: e.AsIdent()}
	case ast.CallKind:
		call := e.AsCall()
		n := node{Kind: "call", Str: call.FunctionName()}
		if call.IsMemberFunction() {
			n.Args = append(n.Args, tree(call.Target()))
		}
		for _, a := range call.Args() {
			n.Args = append(n.Args, tree(a))
		}
		return n
	}
	return node{Kind: "other"}
}

// --- Compiled programs, kept between requests ------------------------------------------------------

type compiled struct {
	prog cel.Program
	errs []issue
}

var (
	cacheMu sync.Mutex
	cache   = map[string]compiled{}
)

func cacheKey(vars []variable, expr string) string {
	sorted := append([]variable{}, vars...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })
	h := sha256.New()
	for _, v := range sorted {
		fmt.Fprintf(h, "%s:%s;", v.Name, v.Type)
	}
	h.Write([]byte{0})
	h.Write([]byte(expr))
	return hex.EncodeToString(h.Sum(nil))
}

func program(env *cel.Env, vars []variable, expr string) compiled {
	key := cacheKey(vars, expr)
	cacheMu.Lock()
	c, ok := cache[key]
	cacheMu.Unlock()
	if ok {
		return c
	}
	checked, errs := compile(env, expr)
	if errs == nil {
		prog, err := env.Program(checked, cel.CostLimit(costLimit), cel.InterruptCheckFrequency(100))
		if err != nil {
			errs = []issue{{Message: err.Error()}}
		}
		c = compiled{prog: prog, errs: errs}
	} else {
		c = compiled{errs: errs}
	}
	cacheMu.Lock()
	if len(cache) >= maxCachedProgs {
		cache = map[string]compiled{}
	}
	cache[key] = c
	cacheMu.Unlock()
	return c
}

// --- HTTP ------------------------------------------------------------------------------------------

type checkRequest struct {
	Expressions map[string]string `json:"expressions"`
	Variables   []variable        `json:"variables"`
}

type checkResult struct {
	Errors []issue `json:"errors,omitempty"`
	Tree   *node   `json:"tree,omitempty"`
}

type evaluateRequest struct {
	Expressions map[string]string `json:"expressions"`
	Variables   []variable        `json:"variables"`
	Inputs      []struct {
		Key       string         `json:"key"`
		Variables map[string]any `json:"variables"`
	} `json:"inputs"`
}

type evaluateResult struct {
	Key     string             `json:"key"`
	Outputs map[string]float64 `json:"outputs"`
	Errors  map[string]string  `json:"errors,omitempty"`
}

func readJSON(w http.ResponseWriter, r *http.Request, into any) bool {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON: " + err.Error()})
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func handleCheck(w http.ResponseWriter, r *http.Request) {
	var req checkRequest
	if !readJSON(w, r, &req) {
		return
	}
	if len(req.Expressions) > maxExpressions {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "too many expressions"})
		return
	}
	env, err := newEnv(req.Variables)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	out := map[string]checkResult{}
	for name, expr := range req.Expressions {
		checked, errs := compile(env, expr)
		if errs != nil {
			out[name] = checkResult{Errors: errs}
			continue
		}
		t := tree(checked.NativeRep().Expr())
		out[name] = checkResult{Tree: &t}
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": out})
}

func toVal(v any) (any, error) {
	switch x := v.(type) {
	case float64:
		return x, nil
	case string:
		return x, nil
	case bool:
		return x, nil
	}
	return nil, fmt.Errorf("unsupported value %T", v)
}

func handleEvaluate(w http.ResponseWriter, r *http.Request) {
	var req evaluateRequest
	if !readJSON(w, r, &req) {
		return
	}
	if len(req.Expressions) > maxExpressions || len(req.Inputs) > maxInputs {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "too many expressions or inputs"})
		return
	}
	env, err := newEnv(req.Variables)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	progs := map[string]compiled{}
	for name, expr := range req.Expressions {
		progs[name] = program(env, req.Variables, expr)
	}
	results := make([]evaluateResult, 0, len(req.Inputs))
	for _, in := range req.Inputs {
		if r.Context().Err() != nil {
			return // timed out; the handler already answered
		}
		res := evaluateResult{Key: in.Key, Outputs: map[string]float64{}}
		vars := map[string]any{}
		for k, v := range in.Variables {
			val, err := toVal(v)
			if err != nil {
				res.Errors = map[string]string{"*": fmt.Sprintf("%s: %v", k, err)}
				break
			}
			vars[k] = val
		}
		if res.Errors == nil {
			for name, c := range progs {
				if c.errs != nil {
					setErr(&res, name, c.errs[0].Message)
					continue
				}
				val, _, err := c.prog.ContextEval(r.Context(), vars)
				if err != nil {
					setErr(&res, name, err.Error())
					continue
				}
				n, ok := number(val)
				if !ok {
					setErr(&res, name, "the result is not a finite number")
					continue
				}
				res.Outputs[name] = n
			}
		}
		results = append(results, res)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func setErr(res *evaluateResult, name, msg string) {
	if res.Errors == nil {
		res.Errors = map[string]string{}
	}
	res.Errors[name] = msg
}

func number(v ref.Val) (float64, bool) {
	var n float64
	switch x := v.(type) {
	case types.Double:
		n = float64(x)
	case types.Int:
		n = float64(x)
	case types.Uint:
		n = float64(x)
	default:
		return 0, false
	}
	return n, !math.IsNaN(n) && !math.IsInf(n, 0)
}

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	health := flag.Bool("health", false, "check a running engine and exit (for the container healthcheck)")
	flag.Parse()
	if *health {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1"+*addr+"/health", nil)
		res, err := http.DefaultClient.Do(req)
		if err != nil || res.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		os.Exit(0)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/check", handleCheck)
	mux.HandleFunc("/evaluate", handleEvaluate)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, map[string]bool{"ok": true}) })
	server := &http.Server{
		Addr:              *addr,
		Handler:           http.TimeoutHandler(mux, requestTimeout, `{"error":"timed out"}`),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	log.Printf("rules engine listening on %s", *addr)
	log.Fatal(server.ListenAndServe())
}
