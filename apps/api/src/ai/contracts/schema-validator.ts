export type SchemaType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface DeepSchema {
  type: SchemaType;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  enum?: (string | number)[];
  items?: DeepSchema;
  properties?: Record<string, DeepSchema>;
}

export function validateDeepSchema(
  schema: DeepSchema,
  data: unknown,
  path: string = 'root'
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (data === undefined || data === null) {
    if (schema.required !== false) {
      errors.push(`${path} is required`);
    }
    return { valid: errors.length === 0, errors };
  }

  if (schema.type === 'string') {
    if (typeof data !== 'string') {
      errors.push(`${path} must be a string`);
      return { valid: false, errors };
    }
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push(`${path} must be at least ${schema.minLength} characters long`);
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push(`${path} must be at most ${schema.maxLength} characters long`);
    }
    if (schema.enum && !schema.enum.includes(data)) {
      errors.push(`${path} must be one of [${schema.enum.join(', ')}]`);
    }
  } else if (schema.type === 'number') {
    if (typeof data !== 'number') {
      errors.push(`${path} must be a number`);
      return { valid: false, errors };
    }
    if (schema.min !== undefined && data < schema.min) {
      errors.push(`${path} must be at least ${schema.min}`);
    }
    if (schema.max !== undefined && data > schema.max) {
      errors.push(`${path} must be at most ${schema.max}`);
    }
    if (schema.enum && !schema.enum.includes(data)) {
      errors.push(`${path} must be one of [${schema.enum.join(', ')}]`);
    }
  } else if (schema.type === 'boolean') {
    if (typeof data !== 'boolean') {
      errors.push(`${path} must be a boolean`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(data)) {
      errors.push(`${path} must be an array`);
      return { valid: false, errors };
    }
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        const itemResult = validateDeepSchema(schema.items, data[i], `${path}[${i}]`);
        errors.push(...itemResult.errors);
      }
    }
  } else if (schema.type === 'object') {
    if (typeof data !== 'object' || Array.isArray(data)) {
      errors.push(`${path} must be an object`);
      return { valid: false, errors };
    }
    
    const obj = data as Record<string, unknown>;
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const val = obj[key];
        const propPath = path === 'root' ? key : `${path}.${key}`;
        const propResult = validateDeepSchema(propSchema, val, propPath);
        errors.push(...propResult.errors);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
