// Fixed CPU and JSON workload for bench-context-mode. Same work as workload.ts.
const primes = [];
for (let n = 2; primes.length < 20000; n++) {
  let prime = true;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
  if (prime) primes.push(n);
}
const rows = primes.map((p, i) => ({ i, p, hex: p.toString(16) }));
const back = JSON.parse(JSON.stringify(rows));
console.log(back.length, back[back.length - 1].p);
