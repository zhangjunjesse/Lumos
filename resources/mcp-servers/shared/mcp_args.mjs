function pickSchemaType(schema) {
  const type = schema?.type;
  if (Array.isArray(type)) {
    return type.find((item) => item !== 'null') || type[0];
  }
  return type;
}

function parseJsonString(value) {
  if (typeof value !== 'string') return { ok: false, value };
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false, value };
  }
}

export function coerceValueBySchema(value, schema) {
  if (!schema || value === null || value === undefined) return value;

  const schemaType = pickSchemaType(schema);
  if ((schemaType === 'integer' || schemaType === 'number') && typeof value === 'string') {
    const text = value.trim();
    if (!text) return value;
    const next = schemaType === 'integer' ? Number.parseInt(text, 10) : Number.parseFloat(text);
    return Number.isFinite(next) ? next : value;
  }

  if (schemaType === 'boolean' && typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(text)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(text)) return false;
    return value;
  }

  if (schemaType === 'array') {
    const source = typeof value === 'string' ? parseJsonString(value) : { ok: true, value };
    if (!source.ok || !Array.isArray(source.value)) return value;
    if (!schema.items) return source.value;
    return source.value.map((item) => coerceValueBySchema(item, schema.items));
  }

  if (schemaType === 'object') {
    const source = typeof value === 'string' ? parseJsonString(value) : { ok: true, value };
    if (!source.ok || !source.value || typeof source.value !== 'object' || Array.isArray(source.value)) {
      return value;
    }
    return coerceArgumentsBySchema(source.value, schema);
  }

  return value;
}

export function coerceArgumentsBySchema(argumentsValue, inputSchema) {
  if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) {
    return {};
  }

  const properties = inputSchema?.properties || {};
  return Object.fromEntries(
    Object.entries(argumentsValue).map(([key, value]) => [
      key,
      coerceValueBySchema(value, properties[key]),
    ]),
  );
}

export function coerceArgumentsByTools(tools, toolName, argumentsValue) {
  const tool = Array.isArray(tools) ? tools.find((item) => item?.name === toolName) : null;
  return coerceArgumentsBySchema(argumentsValue, tool?.inputSchema);
}
