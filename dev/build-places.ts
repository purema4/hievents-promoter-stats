/*
 * Builds public/places.json, the list of Canadian places used to suggest a city and to put promoters on
 * the map, from GeoNames' cities1000 (places of 1000 people or more, CC BY 4.0, https://www.geonames.org):
 *   curl -LO https://download.geonames.org/export/dump/cities1000.zip && unzip cities1000.zip
 *   bun dev/build-places.ts cities1000.txt
 * Each entry: [name, province, latitude, longitude, population], most populous first.
 */
const provinces: Record<string, string> = {
  '01': 'AB', '02': 'BC', '03': 'MB', '04': 'NB', '05': 'NL', '07': 'NS', '08': 'ON', '09': 'PE',
  '10': 'QC', '11': 'SK', '12': 'YT', '13': 'NT', '14': 'NU',
};

const [input] = process.argv.slice(2);
if (!input) throw new Error('Usage: bun dev/build-places.ts cities1000.txt');

const seen = new Set<string>();
const places = (await Bun.file(input).text())
  .split('\n')
  .map((line) => line.split('\t'))
  .filter((f) => f[8] === 'CA' && provinces[f[10]!])
  .map((f) => [f[1]!, provinces[f[10]!]!, Number(Number(f[4]).toFixed(3)), Number(Number(f[5]).toFixed(3)), Number(f[14])] as const)
  .sort((a, b) => b[4] - a[4])
  // One entry per name and province: the most populous.
  .filter(([name, province]) => !seen.has(`${name}|${province}`) && !!seen.add(`${name}|${province}`));

await Bun.write('public/places.json', JSON.stringify(places));
console.log(`${places.length} places written to public/places.json`);

export {};
