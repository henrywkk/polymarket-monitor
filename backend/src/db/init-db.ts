import { query } from '../config/database';
import fs from 'fs';
import path from 'path';
import { SQL_SCHEMA } from './sql-schema';

export async function initializeDatabase(): Promise<void> {
  try {
    console.log('Initializing database...');
    
    // Read the SQL initialization file
    // In production (compiled), it's in dist/db/init.sql
    // In development, it's in src/db/init.sql
    const sqlPath = path.join(__dirname, 'init.sql');
    let sql: string;
    
    console.log('Looking for SQL file at:', sqlPath);
    
    try {
      sql = fs.readFileSync(sqlPath, 'utf-8');
      console.log('Found SQL file at:', sqlPath);
    } catch (error) {
      // Try alternative path for development
      const altPath = path.join(__dirname, '../../src/db/init.sql');
      console.log('Trying alternative path:', altPath);
      try {
        sql = fs.readFileSync(altPath, 'utf-8');
        console.log('Found SQL file at:', altPath);
      } catch (altError) {
        console.warn('Could not find SQL file at either path, using embedded schema:', {
          production: sqlPath,
          development: altPath,
        });
        // Use embedded SQL schema as fallback
        sql = SQL_SCHEMA;
        console.log('Using embedded SQL schema');
      }
    }
    
    // Split by semicolons and execute each statement
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));
    
    console.log(`Executing ${statements.length} SQL statements...`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement) {
        try {
          await query(statement);
          console.log(`Executed statement ${i + 1}/${statements.length}`);
        } catch (error) {
          // Log the error but continue
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (errorMsg.includes('already exists') || errorMsg.includes('duplicate')) {
            console.log(`Statement ${i + 1} skipped (already exists):`, statement.substring(0, 50));
          } else {
            console.error(`Error executing statement ${i + 1}:`, errorMsg);
            console.error('Statement:', statement.substring(0, 100));
          }
        }
      }
    }
    
    // Verify tables were created
    const tablesCheck = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('markets', 'outcomes', 'price_history')
    `);
    
    console.log(`Database initialization complete. Found ${tablesCheck.rows.length} tables:`, 
      tablesCheck.rows.map((r: { table_name: string }) => r.table_name));
    
    if (tablesCheck.rows.length === 0) {
      console.warn('WARNING: No tables found after initialization!');
    }
  } catch (error) {
    console.error('CRITICAL: Error initializing database:', error);
    if (error instanceof Error) {
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
      });
    }
    // Don't throw - allow server to start even if init fails
    // But log it clearly so we can debug
  }
}

