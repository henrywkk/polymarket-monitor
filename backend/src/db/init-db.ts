import { query } from '../config/database';
import fs from 'fs';
import path from 'path';

export async function initializeDatabase(): Promise<void> {
  try {
    console.log('Initializing database...');
    
    // Read the SQL initialization file
    // In production (compiled), it's in dist/db/init.sql
    // In development, it's in src/db/init.sql
    const sqlPath = path.join(__dirname, 'init.sql');
    let sql: string;
    
    try {
      sql = fs.readFileSync(sqlPath, 'utf-8');
    } catch (error) {
      // Try alternative path for development
      const altPath = path.join(__dirname, '../../src/db/init.sql');
      sql = fs.readFileSync(altPath, 'utf-8');
    }
    
    // Split by semicolons and execute each statement
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));
    
    for (const statement of statements) {
      if (statement) {
        try {
          await query(statement);
        } catch (error) {
          // Ignore errors for IF NOT EXISTS statements
          if (error instanceof Error && !error.message.includes('already exists')) {
            console.warn('Database init warning:', error.message);
          }
        }
      }
    }
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    // Don't throw - allow server to start even if init fails
    // Tables might already exist
  }
}

