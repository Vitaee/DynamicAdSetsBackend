#!/usr/bin/env ts-node

// Load environment variables first, before any other imports
import path from 'path';
import dotenv from 'dotenv';

// Try multiple possible .env locations
const envPaths = [
  path.join(__dirname, '../../.env'),           // apps/backend/.env
  path.join(__dirname, '../../../../.env'),     // root/.env
  path.join(process.cwd(), 'apps/backend/.env'), // From root: apps/backend/.env
  path.join(process.cwd(), '.env'),             // From root: .env
];

// Load environment variables from the first existing file
for (const envPath of envPaths) {
  try {
    const result = dotenv.config({ path: envPath });
    if (result.parsed) {
      console.log(`✅ Loaded environment from: ${envPath}`);
      break;
    }
  } catch (error) {
    // Continue to next path
  }
}

import { AutomationEngine } from '../services/AutomationEngine';
import { JobScheduler } from '../services/JobScheduler';
import { RateLimiter } from '../services/RateLimiter';
import { query } from '../config/database';

type CommandFunction = (args: string[]) => Promise<void> | void;

const commands: Record<string, CommandFunction> = {
  'start-worker': startWorker,
  'stop-worker': stopWorker,
  'list-workers': listWorkers,
  'list-rules': listRules,
  'schedule-rule': scheduleRule,
  'run-rule': runRule,
  'list-jobs': listJobs,
  'job-stats': jobStats,
  'rate-limit-stats': rateLimitStats,
  'test-rule': testRule,
  'help': showHelp
};

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  if (!command || !commands[command]) {
    console.log('Invalid command. Use "help" for available commands.');
    process.exit(1);
  }

  try {
    await commands[command](args);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Command failed:', message);
    process.exit(1);
  }
}

async function startWorker(args: string[]) {
  const engineId = args[0] || `cli_engine_${Date.now()}`;

  console.log(`Starting automation engine ${engineId}...`);

  const engine = new AutomationEngine();

  await engine.startEngine();
  console.log(`Automation engine ${engineId} started successfully!`);

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('Stopping automation engine...');
    await engine.stopEngine();
    process.exit(0);
  });
}

async function stopWorker(args: string[]) {
  const engineId = args[0] || 'automation_engine';
  console.log(`Stop command sent for automation engine ${engineId}`);
  console.log('Note: Use SIGTERM to gracefully stop the running automation engine');
}

async function listWorkers(_args: string[]) {
  try {
    // Check if there are any running automation processes
    const result = await query('SELECT COUNT(*) as count FROM automation_rules WHERE is_active = true');
    const activeRules = parseInt(result.rows[0].count) || 0;
    
    console.log('\nAutomation Engine Status:');
    console.log('=========================');
    console.log(`Active Rules: ${activeRules}`);
    
    // Show recent executions
    const executions = await query(`
      SELECT ae.executed_at, ae.success, ar.name 
      FROM automation_executions ae 
      JOIN automation_rules ar ON ae.rule_id = ar.id 
      ORDER BY ae.executed_at DESC 
      LIMIT 5
    `);
    
    if (executions.rows.length > 0) {
      console.log('\nRecent Executions:');
      console.log('==================');
      for (const exec of executions.rows) {
        const status = exec.success ? 'SUCCESS' : 'FAILED';
        console.log(`${exec.executed_at}: ${exec.name} - ${status}`);
      }
    }
  } catch (error) {
    console.log('No automation engine data found or database not connected');
  }
}

async function listRules(_args: string[]) {
  try {
    const result = await query(`
      SELECT 
        id, 
        name, 
        description, 
        is_active, 
        check_interval_minutes,
        location,
        campaigns,
        last_checked_at,
        last_executed_at
      FROM automation_rules 
      ORDER BY is_active DESC, name ASC
    `);
    
    if (result.rows.length === 0) {
      console.log('📭 No automation rules found');
      return;
    }
    
    console.log('\n🎯 Automation Rules:');
    console.log('====================');
    
    for (const rule of result.rows) {
      const status = rule.is_active ? '🟢 ACTIVE' : '🔴 INACTIVE';
      const location = rule.location ? `${rule.location.city}, ${rule.location.country}` : 'Not set';
      const campaigns = Array.isArray(rule.campaigns) ? rule.campaigns.length : 0;
      
      console.log(`\n📋 ${rule.name} (ID: ${rule.id})`);
      console.log(`   Status: ${status}`);
      console.log(`   Location: ${location}`);
      console.log(`   Campaigns: ${campaigns}`);
      console.log(`   Interval: ${rule.check_interval_minutes} minutes`);
      if (rule.description) {
        console.log(`   Description: ${rule.description}`);
      }
      if (rule.last_executed_at) {
        console.log(`   Last Executed: ${rule.last_executed_at}`);
      }
      
      if (rule.is_active) {
        console.log(`   💡 Run immediately: automation-cli run-rule ${rule.id}`);
      }
    }
    
    const activeCount = result.rows.filter((r: any) => r.is_active).length;
    console.log(`\n📊 Total: ${result.rows.length} rules (${activeCount} active)`);
    
  } catch (error: any) {
    console.log(`❌ Failed to list rules: ${error.message}`);
  }
}

async function scheduleRule(args: string[]) {
  const ruleId = args[0];
  const userId = args[1];
  const intervalMinutes = parseInt(args[2] || '60') || 60;

  if (!ruleId || !userId) {
    console.log('Usage: schedule-rule <rule-id> <user-id> [interval-minutes]');
    return;
  }

  const scheduler = new JobScheduler();
  await scheduler.connect();

  await scheduler.scheduleRuleCheck(ruleId, userId, intervalMinutes);
  console.log(`Scheduled rule ${ruleId} to check every ${intervalMinutes} minutes`);

  await scheduler.disconnect();
}

async function runRule(args: string[]) {
  const ruleId = args[0];
  if (!ruleId) {
    console.log('Usage: run-rule <rule-id>');
    return;
  }

  // Verify rule exists and is active
  const result = await query('SELECT * FROM automation_rules WHERE id = $1', [ruleId]);
  if (result.rows.length === 0) {
    console.log(`❌ Rule ${ruleId} not found`);
    return;
  }

  const rule = result.rows[0];
  if (!rule.is_active) {
    console.log(`⚠️  Rule ${ruleId} (${rule.name}) is not active. Activate it first to run.`);
    return;
  }

  console.log(`🚀 Triggering immediate execution for rule: ${rule.name}`);
  console.log(`📍 Location: ${rule.location.city}, ${rule.location.country}`);
  console.log(`⚙️  Campaigns: ${rule.campaigns.length} configured`);

  const engine = new AutomationEngine();
  try {
    console.log('🔄 Connecting to services...');
    await engine.startEngine();
    
    console.log('▶️  Executing rule...');
    const startTime = Date.now();
    
    await engine.runRuleOnce(ruleId);
    
    const executionTime = Date.now() - startTime;
    console.log(`✅ Rule execution completed in ${executionTime}ms`);
    
    // Show the latest execution result
    const latestExecution = await query(
      'SELECT * FROM automation_executions WHERE rule_id = $1 ORDER BY executed_at DESC LIMIT 1',
      [ruleId]
    );
    
    if (latestExecution.rows.length > 0) {
      const exec = latestExecution.rows[0];
      console.log('\n📊 Execution Results:');
      console.log('=====================');
      console.log(`Status: ${exec.success ? '✅ SUCCESS' : '❌ FAILED'}`);
      console.log(`Conditions Met: ${exec.conditions_met ? '✅ YES' : '❌ NO'}`);
      console.log(`Actions Taken: ${JSON.stringify(exec.actions_taken, null, 2)}`);
      if (exec.error_message) {
        console.log(`Error: ${exec.error_message}`);
      }
      if (exec.execution_metrics) {
        const metrics = typeof exec.execution_metrics === 'string' 
          ? JSON.parse(exec.execution_metrics)
          : exec.execution_metrics;
        console.log(`\n📈 Metrics:`);
        console.log(`  Weather API Calls: ${metrics.weatherApiCalls || 0}`);
        console.log(`  Meta API Calls: ${metrics.metaApiCalls || 0}`);
        console.log(`  Google API Calls: ${metrics.googleApiCalls || 0}`);
        console.log(`  Execution Time: ${metrics.totalExecutionTime || 0}ms`);
      }
    }
    
  } catch (error: any) {
    console.log(`❌ Rule execution failed: ${error.message}`);
  } finally {
    await engine.stopEngine();
  }
}

async function listJobs(_args: string[]) {
  const scheduler = new JobScheduler();
  await scheduler.connect();

  const stats = await scheduler.getJobStats();
  console.log('\nJob Statistics:');
  console.log('===============');
  console.log(`Scheduled: ${stats.scheduled}`);
  console.log(`Processing: ${stats.processing}`);
  console.log(`Overdue: ${stats.overdue}`);

  await scheduler.disconnect();
}

async function jobStats(_args: string[]) {
  const scheduler = new JobScheduler();
  await scheduler.connect();

  const stats = await scheduler.getJobStats();
  
  console.log('\nDetailed Job Statistics:');
  console.log('========================');
  console.log(JSON.stringify(stats, null, 2));

  await scheduler.disconnect();
}

async function rateLimitStats(_args: string[]) {
  const rateLimiter = new RateLimiter();
  await rateLimiter.connect();

  const stats = await rateLimiter.getRateLimitStats();
  
  console.log('\nRate Limit Statistics:');
  console.log('======================');
  for (const [service, serviceStats] of Object.entries(stats)) {
    console.log(`${service}:`);
    console.log(`  Current: ${serviceStats.current}/${serviceStats.max}`);
    console.log(`  Remaining: ${serviceStats.remaining}`);
    console.log(`  Window: ${serviceStats.windowMs}ms`);
  }

  await rateLimiter.disconnect();
}

async function testRule(args: string[]) {
  const ruleId = args[0];
  if (!ruleId) {
    console.log('Usage: test-rule <rule-id>');
    return;
  }

  // Get rule from database
  const result = await query('SELECT * FROM automation_rules WHERE id = $1', [ruleId]);
  if (result.rows.length === 0) {
    console.log(`Rule ${ruleId} not found`);
    return;
  }

  const rule = result.rows[0];
  console.log('\nRule Details:');
  console.log('=============');
  console.log(`Name: ${rule.name}`);
  console.log(`Description: ${rule.description}`);
  console.log(`Active: ${rule.is_active}`);
  console.log(`Location: ${JSON.stringify(rule.location, null, 2)}`);
  console.log(`Conditions: ${JSON.stringify(rule.conditions, null, 2)}`);
  console.log(`Campaigns: ${JSON.stringify(rule.campaigns, null, 2)}`);
  console.log(`Check Interval: ${rule.check_interval_minutes} minutes`);

  // Show recent executions
  const executions = await query(
    'SELECT * FROM automation_executions WHERE rule_id = $1 ORDER BY executed_at DESC LIMIT 5',
    [ruleId]
  );

  if (executions.rows.length > 0) {
    console.log('\nRecent Executions:');
    console.log('==================');
    for (const execution of executions.rows) {
      console.log(`${execution.executed_at}: ${execution.success ? 'SUCCESS' : 'FAILED'} - Conditions Met: ${execution.conditions_met}`);
      if (execution.error_message) {
        console.log(`  Error: ${execution.error_message}`);
      }
    }
  }
}

function showHelp(_args: string[]) {
  console.log(`
WeatherTrigger Automation CLI

Commands:
  start-worker [engine-id]               Start the automation engine
  stop-worker [engine-id]                Stop the automation engine  
  list-workers                           Show automation engine status
  list-rules                             📋 List all automation rules with IDs
  schedule-rule <rule-id> <user-id> [interval]  Schedule a rule check
  run-rule <rule-id>                     🚀 Run a rule immediately (bypasses interval)
  list-jobs                              Show job queue statistics
  job-stats                              Show detailed job statistics
  rate-limit-stats                       Show API rate limit status
  test-rule <rule-id>                    Test a specific rule (dry run)
  help                                   Show this help message

Examples:
  automation-cli list-rules                       ← List all rules with IDs
  automation-cli run-rule rule123                 ← Trigger rule immediately
  automation-cli start-worker my-engine
  automation-cli schedule-rule rule123 user456 30
  automation-cli test-rule rule123
  automation-cli list-workers
`);
}

if (require.main === module) {
  main().catch(console.error);
}

export { main };
