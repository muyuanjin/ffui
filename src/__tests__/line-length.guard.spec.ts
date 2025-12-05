import fs from 'fs'
import path from 'path'
import { describe, it } from 'vitest'

const THRESHOLD = 500
const ALLOWED_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue'
])
const NOTE =
  '本测试禁止修改或跳过，必须运行，用于防止单个前端源码文件超过500行，请通过重构拆分解决。'

const frontendRoot = path.join(process.cwd(), 'src')

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip obvious non-source directories if they ever appear under src
      if (['node_modules', 'dist', '.git'].includes(entry.name)) return []
      return collectSourceFiles(fullPath)
    }
    if (!entry.isFile()) return []
    const ext = path.extname(entry.name)
    return ALLOWED_EXTS.has(ext) ? [fullPath] : []
  })
}

describe('line length guard (DO NOT MODIFY/SKIP, MUST RUN)', () => {
  it('fails when any frontend source file exceeds 500 lines', () => {
    if (!fs.existsSync(frontendRoot)) {
      throw new Error(`${NOTE} 未找到前端目录: ${frontendRoot}`)
    }

    const files = collectSourceFiles(frontendRoot)
    const overLimit = files
      .map((file) => {
        const content = fs.readFileSync(file, 'utf8')
        const lines = content.split(/\r?\n/).length
        return { file, lines }
      })
      .filter(({ lines }) => lines > THRESHOLD)
      .sort((a, b) => b.lines - a.lines)

    if (overLimit.length > 0) {
      const details = overLimit
        .map(({ file, lines }) => {
          const relative = path.relative(process.cwd(), file)
          const over = lines - THRESHOLD
          return `${relative}: ${lines} 行（超出 ${over} 行）`
        })
        .join('\n')

      throw new Error(
        `${NOTE}\n以下前端文件需拆分（>${THRESHOLD} 行）：\n${details}`
      )
    }
  })
})
