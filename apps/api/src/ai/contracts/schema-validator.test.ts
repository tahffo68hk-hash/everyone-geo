import { DeepSchema, validateDeepSchema } from './schema-validator';

describe('Schema Validator', () => {
  it('should validate string types', () => {
    const schema: DeepSchema = { type: 'string', minLength: 2, maxLength: 5 };
    expect(validateDeepSchema(schema, 'abc').valid).toBe(true);
    expect(validateDeepSchema(schema, 'a').valid).toBe(false);
    expect(validateDeepSchema(schema, 'abcdef').valid).toBe(false);
    expect(validateDeepSchema(schema, 123).valid).toBe(false);
  });

  it('should validate enums', () => {
    const schema: DeepSchema = { type: 'string', enum: ['A', 'B'] };
    expect(validateDeepSchema(schema, 'A').valid).toBe(true);
    expect(validateDeepSchema(schema, 'C').valid).toBe(false);
  });

  it('should validate arrays', () => {
    const schema: DeepSchema = {
      type: 'array',
      items: { type: 'number' }
    };
    expect(validateDeepSchema(schema, [1, 2, 3]).valid).toBe(true);
    expect(validateDeepSchema(schema, []).valid).toBe(true);
    
    const res = validateDeepSchema(schema, [1, '2']);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('root[1] must be a number');
  });

  it('should validate nested objects', () => {
    const schema: DeepSchema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number', required: false } // age is technically required if it's missing entirely but we handle it via required flag
          }
        }
      }
    };
    
    expect(validateDeepSchema(schema, { user: { name: 'Alice', age: 30 } }).valid).toBe(true);
    
    const missingName = validateDeepSchema(schema, { user: { age: 30 } });
    expect(missingName.valid).toBe(false);
    expect(missingName.errors).toContain('user.name is required');
  });

  it('should report correct paths for errors', () => {
    const schema: DeepSchema = {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              intent: { type: 'string', enum: ['INFORMATIONAL', 'COMMERCIAL'] }
            }
          }
        }
      }
    };

    const res = validateDeepSchema(schema, { queries: [{ intent: 'INFORMATIONAL' }, { intent: 'UNKNOWN' }] });
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('queries[1].intent must be one of [INFORMATIONAL, COMMERCIAL]');
  });
});
