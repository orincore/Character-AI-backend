-- Check the actual table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default,
    character_maximum_length
FROM 
    information_schema.columns 
WHERE 
    table_schema = 'public' 
    AND table_name = 'chat_messages';

-- Check if there are any triggers or functions that might be modifying the data
SELECT 
    trigger_name, 
    event_manipulation, 
    action_statement,
    action_timing
FROM 
    information_schema.triggers
WHERE 
    event_object_table = 'chat_messages';

-- Check for any rules on the table
SELECT 
    rule_name, 
    definition
FROM 
    information_schema.rules
WHERE 
    table_name = 'chat_messages';
