import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { getRepoRoot, getProjectStorageDir } from './git.js'

export interface UiStateStore {
  getAll(): Promise<Record<string, any>>
  setAll(state: Record<string, any>): Promise<void>
}

export class FileUiStateStore implements UiStateStore {
  private dirPath: string
  private filePath: string

  constructor(storageDir?: string) {
    this.dirPath = storageDir ?? getProjectStorageDir()
    this.filePath = join(this.dirPath, 'ui-state.json')
  }

  async getAll(): Promise<Record<string, any>> {
    try {
      const data = await readFile(this.filePath, 'utf-8')
      return JSON.parse(data)
    } catch {
      return {}
    }
  }

  async setAll(state: Record<string, any>): Promise<void> {
    await this.save(state)
  }

  private async save(state: Record<string, any>): Promise<void> {
    try {
      await mkdir(this.dirPath, { recursive: true })
      try {
        const repoRoot = getRepoRoot()
        await writeFile(join(this.dirPath, 'repo_path.txt'), repoRoot, 'utf-8')
      } catch {
        // Ignore if outside git repo or in mock sandboxes
      }
      await writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf-8')
    } catch (err) {
      console.error('Failed to save UI state to file:', err)
    }
  }
}
