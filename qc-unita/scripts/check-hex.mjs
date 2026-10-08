// Garante a regra da identidade visual: nenhum hex fora de src/styles/tokens.css.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const offenders = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(tsx?|css)$/.test(name) && !p.endsWith('tokens.css') && !p.endsWith('tokens.ts')) {
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (/#[0-9a-fA-F]{6}\b/.test(line)) offenders.push(`${p}:${i + 1}: ${line.trim()}`)
      })
    }
  }
}
walk('src')
if (offenders.length) {
  console.error('Hex fora de tokens.css:\n' + offenders.join('\n'))
  process.exit(1)
}
console.log('OK — nenhum hex fora de tokens.css')
