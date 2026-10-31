import { cpSync, rmSync } from 'node:fs'

rmSync('dist/server/scripts', { recursive: true, force: true })
cpSync('server/src/scripts', 'dist/server/scripts', { recursive: true })
