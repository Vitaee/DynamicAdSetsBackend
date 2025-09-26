import { query } from '../config/database'
import os from 'os'

export interface WorkerRecord {
  worker_id: string
  status: string
  started_at: Date
  last_heartbeat: Date
  max_concurrent_jobs: number
  current_jobs: number
  jobs_processed: number
  jobs_succeeded: number
  jobs_failed: number
  created_at: Date
  updated_at: Date
}

export class WorkerRegistryService {
  private workerId: string
  private maxConcurrent: number

  constructor(workerId?: string, maxConcurrent: number = 5) {
    const host = os.hostname()
    this.workerId = workerId || `${host}:${process.pid}`
    this.maxConcurrent = maxConcurrent
  }

  getId(): string { return this.workerId }

  async register(): Promise<void> {
    const now = new Date()
    await query(
      `INSERT INTO worker_registry (
        worker_id, status, started_at, last_heartbeat, max_concurrent_jobs, current_jobs, 
        jobs_processed, jobs_succeeded, jobs_failed
      ) VALUES ($1, $2, $3, $4, $5, 0, 0, 0, 0)
      ON CONFLICT (worker_id) DO UPDATE SET
        status = EXCLUDED.status,
        last_heartbeat = EXCLUDED.last_heartbeat,
        max_concurrent_jobs = EXCLUDED.max_concurrent_jobs,
        updated_at = CURRENT_TIMESTAMP`,
      [this.workerId, 'running', now, now, this.maxConcurrent]
    )
  }

  async heartbeat(currentJobs: number): Promise<void> {
    await query(
      `UPDATE worker_registry 
       SET last_heartbeat = CURRENT_TIMESTAMP,
           current_jobs = $2,
           status = 'running'
       WHERE worker_id = $1`,
      [this.workerId, currentJobs]
    )
  }

  async incrementProcessed(succeeded: boolean): Promise<void> {
    await query(
      `UPDATE worker_registry 
       SET jobs_processed = jobs_processed + 1,
           ${succeeded ? 'jobs_succeeded = jobs_succeeded + 1' : 'jobs_failed = jobs_failed + 1'},
           updated_at = CURRENT_TIMESTAMP
       WHERE worker_id = $1`,
      [this.workerId]
    )
  }

  async setStatus(status: 'starting' | 'running' | 'stopping' | 'stopped'): Promise<void> {
    await query(
      `UPDATE worker_registry SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE worker_id = $1`,
      [this.workerId, status]
    )
  }

  async getWorkers(): Promise<WorkerRecord[]> {
    const res = await query(`SELECT * FROM worker_registry ORDER BY started_at DESC`)
    return res.rows
  }
}

