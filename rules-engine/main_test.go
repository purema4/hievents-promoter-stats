package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

var vars = []variable{{"tickets_sold", "number"}, {"full_price_sales", "number"}, {"level", "string"}, {"is_team_lead", "bool"}}

func post(t *testing.T, h http.HandlerFunc, body any) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b)))
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// Ash's deal: 2 VIP from the first ticket, 1 GA list spot every 5 tickets, $5 a ticket.
func TestAsh(t *testing.T) {
	exprs := map[string]string{
		"commission":  "tickets_sold * 5.00",
		"vip_tickets": "tickets_sold >= 1 ? 2 : 0",
		"ga_list":     "floor(tickets_sold / 5)",
	}
	want := map[float64][3]float64{1: {5, 2, 0}, 4: {20, 2, 0}, 5: {25, 2, 1}, 12: {60, 2, 2}, 20: {100, 2, 4}}
	var inputs []map[string]any
	for sold := range want {
		inputs = append(inputs, map[string]any{"key": strings.Repeat("x", int(sold)), "variables": map[string]any{"tickets_sold": sold, "full_price_sales": 0.0, "level": "Gold", "is_team_lead": false}})
	}
	code, out := post(t, handleEvaluate, map[string]any{"expressions": exprs, "variables": vars, "inputs": inputs})
	if code != 200 {
		t.Fatalf("status %d: %v", code, out)
	}
	for _, r := range out["results"].([]any) {
		res := r.(map[string]any)
		sold := float64(len(res["key"].(string)))
		o := res["outputs"].(map[string]any)
		got := [3]float64{o["commission"].(float64), o["vip_tickets"].(float64), o["ga_list"].(float64)}
		if got != want[sold] {
			t.Errorf("%v sold: got %v, want %v", sold, got, want[sold])
		}
	}
}

func check(t *testing.T, expr string) map[string]any {
	t.Helper()
	code, out := post(t, handleCheck, map[string]any{"expressions": map[string]string{"x": expr}, "variables": vars})
	if code != 200 {
		t.Fatalf("status %d: %v", code, out)
	}
	return out["results"].(map[string]any)["x"].(map[string]any)
}

func TestNumbersMixFreely(t *testing.T) {
	for _, expr := range []string{"tickets_sold * 5", "tickets_sold * 5.0", "75 + tickets_sold", "min(tickets_sold, 10) * 2", "max(1, 2, 3)", "round(full_price_sales * 0.1)", "level == 'Gold' ? 10 : 0", "is_team_lead ? 1 : 0", "ceil(7 / 2)"} {
		if r := check(t, expr); r["errors"] != nil {
			t.Errorf("%s: %v", expr, r["errors"])
		}
	}
}

func TestRefused(t *testing.T) {
	for expr, want := range map[string]string{
		"tickets_sold >= 1":             "must be a number",
		"'text'":                        "must be a number",
		"unknown_var * 2":               "undeclared reference",
		"tickets_sold * ":               "Syntax error",
		"":                              "empty",
		strings.Repeat("1+", 600) + "1": "longer than",
	} {
		r := check(t, expr)
		errs, _ := r["errors"].([]any)
		if len(errs) == 0 || !strings.Contains(errs[0].(map[string]any)["message"].(string), want) {
			t.Errorf("%q: got %v, want an error with %q", expr, r, want)
		}
	}
}

func TestTree(t *testing.T) {
	r := check(t, "tickets_sold >= 1 ? 2 : 0")
	b, _ := json.Marshal(r["tree"])
	var got, want node
	_ = json.Unmarshal(b, &got)
	_ = json.Unmarshal([]byte(`{"k":"call","s":"_?_:_","a":[{"k":"call","s":"_>=_","a":[{"k":"var","s":"tickets_sold"},{"k":"num","v":1}]},{"k":"num","v":2},{"k":"num"}]}`), &want)
	gb, _ := json.Marshal(got)
	wb, _ := json.Marshal(want)
	if string(gb) != string(wb) {
		t.Errorf("tree %s", gb)
	}
}

func TestCostLimit(t *testing.T) {
	// A long chain of calls stays far under the limit; the limit is there for anything unusual.
	expr := strings.Repeat("max(", 40) + "tickets_sold" + strings.Repeat(", 1)", 40)
	if r := check(t, expr); r["errors"] != nil {
		t.Fatalf("%v", r["errors"])
	}
}

func TestMissingVariable(t *testing.T) {
	_, out := post(t, handleEvaluate, map[string]any{
		"expressions": map[string]string{"commission": "tickets_sold * 5"},
		"variables":   vars,
		"inputs":      []map[string]any{{"key": "a", "variables": map[string]any{}}},
	})
	res := out["results"].([]any)[0].(map[string]any)
	if res["errors"] == nil {
		t.Fatalf("expected an error, got %v", res)
	}
}

func TestUnknownFieldsRefused(t *testing.T) {
	code, _ := post(t, handleCheck, map[string]any{"expressions": map[string]string{}, "variables": vars, "eval": "x"})
	if code != 400 {
		t.Fatalf("status %d", code)
	}
}
