import { AutomationEngine } from './AutomationEngine'
import { WorkerRegistryService } from './WorkerRegistry'
import { logger } from '../utils/logger'

// Singleton AutomationEngine instance to be shared across routes/controllers
export const engine = new AutomationEngine()
const registry = new WorkerRegistryService()
let heartbeatTimer: NodeJS.Timeout | null = null
let currentJobsGauge = 0

export async function startEngineSingleton(): Promise<void> {
  try {
    // Register worker and start heartbeats
    await registry.register()
    await engine.startEngine()
    heartbeatTimer = setInterval(async () => {
      try { await registry.heartbeat(currentJobsGauge) } catch {}
    }, 15000)
    logger.info('Automation engine singleton started')
  } catch (error) {
    logger.error('Failed to start automation engine singleton:', error)
  }
}

export async function stopEngineSingleton(): Promise<void> {
  try {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    await registry.setStatus('stopping')
    await engine.stopEngine()
    await registry.setStatus('stopped')
    logger.info('Automation engine singleton stopped')
  } catch (error) {
    logger.error('Failed to stop automation engine singleton:', error)
  }
}

// Hooks used by engine to update worker stats
export const workerStatsHooks = {
  setCurrentJobs: (n: number) => { currentJobsGauge = n },
  markProcessed: async (ok: boolean) => { try { await registry.incrementProcessed(ok) } catch {} },
  setStatus: async (status: 'starting' | 'running' | 'stopping' | 'stopped') => { try { await registry.setStatus(status) } catch {} },
  getWorkers: async () => registry.getWorkers(),
}
