/**
 * Generates backend/docs/API_ENDPOINTS.md with full path/query/body parameters.
 * Run: node scripts/extract-api-endpoints.js  (from backend/)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'docs', 'API_ENDPOINTS.md');

function walk(dir, pred, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, files);
    else if (pred(e.name, p)) files.push(p);
  }
  return files;
}

function findMatching(src, openIndex) {
  const open = src[openIndex];
  const close = open === '(' ? ')' : open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) return -1;
  let depth = 0;
  let inStr = null;
  let escape = false;
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      i += 1;
      while (i + 1 < src.length && src[i + 1] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i + 1 < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Parse fields from a class body string */
function parseFields(body) {
  const fields = [];
  // Match property declarations: decorators then name?: type = default;
  const propRe =
    /((?:@[A-Za-z][\w.]*(?:\([\s\S]*?\))?\s*)*)(readonly\s+)?([A-Za-z_]\w*)(\?)?:\s*([^=;\n]+?)(?:\s*=\s*([^;\n]+))?;/g;
  let m;
  const cleaned = body;
  while ((m = propRe.exec(cleaned)) !== null) {
    const decos = m[1] || '';
    const name = m[3];
    if (['constructor', 'get', 'set'].includes(name)) continue;
    // Skip methods (have () in type area incorrectly) — type shouldn't start with (
    let type = m[5].trim().replace(/\s+/g, ' ');
    if (type.startsWith('(') || type.includes('=>')) continue;
    const optional =
      !!m[4] || /@IsOptional\b/.test(decos) || /ApiPropertyOptional/.test(decos);
    const required = /@IsNotEmpty\b/.test(decos) || (!optional && /@ApiProperty\(/.test(decos));
    const enumM =
      decos.match(/@IsEnum\((\w+)\)/) ||
      decos.match(/enum:\s*(\w+)/) ||
      type.match(/^(\w+)$/);
    let enumName = null;
    if (/@IsEnum\((\w+)\)/.test(decos)) enumName = RegExp.$1;
    else if (/enum:\s*(\w+)/.test(decos)) enumName = RegExp.$1;

    const maxLen = decos.match(/@MaxLength\((\d+)\)/)?.[1];
    const min = decos.match(/@Min\(([^)]+)\)/)?.[1];
    const max = decos.match(/@Max\(([^)]+)\)/)?.[1];
    const defaultVal = m[6] ? m[6].trim() : undefined;
    const description =
      decos.match(/description:\s*['`]([^'`]+)['`]/)?.[1] ||
      decos.match(/@ApiProperty(?:Optional)?\(\s*\{\s*[^}]*description:\s*['`]([^'`]+)['`]/)?.[1];

    // Normalize type
    if (enumName && type === enumName) type = `enum:${enumName}`;
    else if (/@IsEnum\((\w+)\)/.test(decos)) type = `enum:${RegExp.$1}`;
    else if (/@IsBoolean\b|@IsBooleanString\b/.test(decos) && !type.includes('|'))
      type = type.includes('string') ? 'boolean-string' : 'boolean';
    else if (/@IsInt\b/.test(decos)) type = 'number (int)';
    else if (/@IsNumber\b/.test(decos)) type = 'number';
    else if (/@IsDateString\b|@IsISO8601\b/.test(decos)) type = 'ISO date string';
    else if (/@IsArray\b/.test(decos) || type.endsWith('[]')) {
      /* keep */
    } else if (/@IsEmail\b/.test(decos)) type = 'email string';
    else if (/@IsUrl\b/.test(decos)) type = 'url string';
    else if (/@IsString\b/.test(decos) && type === 'string') type = 'string';

    const constraints = [];
    if (maxLen) constraints.push(`maxLength=${maxLen}`);
    if (min !== undefined) constraints.push(`min=${min}`);
    if (max !== undefined) constraints.push(`max=${max}`);
    if (defaultVal !== undefined) constraints.push(`default=${defaultVal}`);

    fields.push({
      name,
      type,
      optional: optional && !required,
      constraints: constraints.join(', '),
      description: description || '',
    });
  }
  return fields;
}

/** Build DTO registry: name -> { file, extends, partialOf, omit, fields } */
function buildDtoRegistry() {
  const files = walk(SRC, (n) => n.endsWith('.dto.ts') || n === 'pagination.dto.ts');
  const registry = new Map();

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(SRC, file).replace(/\\/g, '/');

    // Find each export class
    const classRe = /export\s+class\s+(\w+)\s+(extends\s+([\s\S]*?))?\s*\{/g;
    let cm;
    while ((cm = classRe.exec(src)) !== null) {
      const name = cm[1];
      const extendsRaw = (cm[2] || '').replace(/^extends\s+/, '').trim();
      const bodyStart = cm.index + cm[0].length - 1;
      const bodyEnd = findMatching(src, bodyStart);
      const body = bodyEnd > 0 ? src.slice(bodyStart + 1, bodyEnd) : '';

      let base = null;
      let partial = false;
      let omit = [];
      let pick = [];

      if (extendsRaw) {
        // Strip comments so PartialType(\n  // note\n  OmitType(...)) still matches
        const ext = stripComments(extendsRaw).replace(/\s+/g, ' ').trim();

        // PartialType(OmitType(X, [...] as const))
        // PartialType(X)
        // OmitType(X, [...])
        // X
        const partialOmit = ext.match(
          /PartialType\(\s*OmitType\(\s*(\w+)\s*,\s*\[([^\]]*)\]/,
        );
        const partialPick = ext.match(
          /PartialType\(\s*PickType\(\s*(\w+)\s*,\s*\[([^\]]*)\]/,
        );
        const partialOnly = ext.match(/PartialType\(\s*(\w+)\s*\)/);
        const omitOnly = ext.match(/OmitType\(\s*(\w+)\s*,\s*\[([^\]]*)\]/);
        const plain = ext.match(/^(\w+)$/);

        const parseKeys = (s) =>
          (s || '')
            .split(',')
            .map((x) => x.trim().replace(/['"]/g, ''))
            .filter((x) => x && x !== 'as' && x !== 'const');

        if (partialOmit) {
          base = partialOmit[1];
          partial = true;
          omit = parseKeys(partialOmit[2]);
        } else if (partialPick) {
          base = partialPick[1];
          partial = true;
          pick = parseKeys(partialPick[2]);
        } else if (partialOnly) {
          base = partialOnly[1];
          partial = true;
        } else if (omitOnly) {
          base = omitOnly[1];
          omit = parseKeys(omitOnly[2]);
        } else if (plain) {
          base = plain[1];
        } else if (/PartialType/.test(ext)) {
          // PartialType(Something(...)) — take innermost class name after PartialType
          partial = true;
          base = ext.match(/PartialType\(\s*(?:\w+\(\s*)*(\w+)/)?.[1] || null;
          const omitM = ext.match(/OmitType\(\s*(\w+)\s*,\s*\[([^\]]*)\]/);
          if (omitM) {
            base = omitM[1];
            omit = parseKeys(omitM[2]);
          }
        } else {
          base = ext.match(/(\w+)/)?.[1] || null;
        }
      }

      registry.set(name, {
        name,
        file: rel,
        base,
        partial,
        omit,
        pick,
        ownFields: parseFields(body),
      });
    }
  }

  // Resolve inherited fields (with cycle guard)
  function resolve(name, stack = []) {
    const dto = registry.get(name);
    if (!dto) return [];
    if (stack.includes(name)) return dto.ownFields.slice();
    const nextStack = [...stack, name];
    let fields = [];
    if (dto.base && registry.has(dto.base)) {
      fields = resolve(dto.base, nextStack).map((f) => ({ ...f }));
      if (dto.omit.length) fields = fields.filter((f) => !dto.omit.includes(f.name));
      if (dto.pick.length) fields = fields.filter((f) => dto.pick.includes(f.name));
      if (dto.partial) fields = fields.map((f) => ({ ...f, optional: true }));
    }
    // Own fields override / append
    const byName = new Map(fields.map((f) => [f.name, f]));
    for (const f of dto.ownFields) byName.set(f.name, f);
    return [...byName.values()];
  }

  for (const [name, dto] of registry) {
    dto.fields = resolve(name);
  }
  return registry;
}

function extractSummary(block) {
  const m = block.match(/@ApiOperation\(\s*\{\s*summary:\s*['`]([^'`]+)['`]/);
  if (m) return m[1].trim();
  const line = block.match(/\/\/\s*(.+)/);
  if (line && !line[1].startsWith('SPRINT')) return line[1].trim();
  return '';
}

function hasFileUpload(block) {
  return /FileInterceptor|FilesInterceptor|UploadedFile|UploadedFiles/.test(block);
}

function parseParamBlock(paramBlock) {
  const pathParams = [];
  const queryNamed = [];
  let queryDto = null;
  let bodyDto = null;
  let usesCurrentUser = /@CurrentUser\b/.test(paramBlock);
  let uploadedFiles = /@UploadedFiles?\b/.test(paramBlock);

  // @Param('id') id: string
  const paramRe = /@Param\('([^']+)'\)\s+(\w+)\s*:\s*([^,)\n]+)/g;
  let m;
  while ((m = paramRe.exec(paramBlock)) !== null) {
    pathParams.push({ name: m[1], type: m[3].trim() });
  }

  // @Query('status') status?: string
  const qNamedRe = /@Query\('([^']+)'\)\s+(\w+)(\?)?\s*:\s*([^,)\n]+)/g;
  while ((m = qNamedRe.exec(paramBlock)) !== null) {
    queryNamed.push({
      name: m[1],
      type: m[4].trim(),
      optional: !!m[3],
    });
  }

  // @Query() query: SomeDto
  const qDto = paramBlock.match(/@Query\(\)\s+\w+\s*:\s*(\w+)/);
  if (qDto) queryDto = qDto[1];

  const bDto = paramBlock.match(/@Body\(\)\s+\w+\s*:\s*(\w+)/);
  if (bDto) bodyDto = bDto[1];

  return { pathParams, queryNamed, queryDto, bodyDto, usesCurrentUser, uploadedFiles };
}

function collectPrecedingDecorators(src, httpIndex) {
  let j = httpIndex - 1;
  const parts = [];
  while (j >= 0) {
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0) break;
    if (src[j] === '/' && j > 0 && src[j - 1] === '*') {
      const start = src.lastIndexOf('/*', j);
      if (start < 0) break;
      parts.unshift(src.slice(start, j + 1));
      j = start - 1;
      continue;
    }
    if (src[j] === '/' && j > 0 && src[j - 1] === '/') {
      let lineStart = j;
      while (lineStart > 0 && src[lineStart - 1] !== '\n') lineStart--;
      parts.unshift(src.slice(lineStart, j + 1));
      j = lineStart - 1;
      continue;
    }
    if (src[j] === ')') {
      let depth = 0;
      let inStr = null;
      let escape = false;
      let open = -1;
      for (let k = j; k >= 0; k--) {
        const ch = src[k];
        if (inStr) {
          if (escape) escape = false;
          else if (ch === '\\') escape = true;
          else if (ch === inStr) inStr = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
          inStr = ch;
          continue;
        }
        if (ch === '/' && k > 0 && src[k - 1] === '/') {
          // line comment — skip back (rare in reverse)
        }
        if (ch === ')') depth++;
        else if (ch === '(') {
          depth--;
          if (depth === 0) {
            open = k;
            break;
          }
        }
      }
      if (open < 0) break;
      let at = open - 1;
      while (at >= 0 && /[\w.]/.test(src[at])) at--;
      if (src[at] !== '@') break;
      parts.unshift(src.slice(at, j + 1));
      j = at - 1;
      continue;
    }
    if (/[A-Za-z_]/.test(src[j])) {
      let end = j + 1;
      while (j >= 0 && /[\w.]/.test(src[j])) j--;
      if (src[j] === '@') {
        parts.unshift(src.slice(j, end));
        j = j - 1;
        continue;
      }
    }
    break;
  }
  return parts.join('\n');
}

function formatFieldRow(f) {
  const req = f.optional ? 'optional' : 'required';
  const extra = [f.constraints, f.description].filter(Boolean).join('; ');
  return `| \`${f.name}\` | ${f.type} | ${req} | ${extra || '—'} |`;
}

function formatParamsSection(ep, registry) {
  const lines = [];

  if (ep.pathParams.length) {
    lines.push('**Path parameters**');
    lines.push('');
    lines.push('| Name | Type |');
    lines.push('|------|------|');
    for (const p of ep.pathParams) {
      lines.push(`| \`${p.name}\` | ${p.type} |`);
    }
    lines.push('');
  }

  const queryFields = [];
  if (ep.queryDto && registry.has(ep.queryDto)) {
    for (const f of registry.get(ep.queryDto).fields) {
      if (f.name === '_') continue; // cache buster
      queryFields.push(f);
    }
  }
  for (const q of ep.queryNamed) {
    queryFields.push({
      name: q.name,
      type: q.type,
      optional: q.optional,
      constraints: '',
      description: '',
    });
  }
  if (queryFields.length) {
    lines.push(
      ep.queryDto
        ? `**Query parameters** (\`${ep.queryDto}\`)`
        : '**Query parameters**',
    );
    lines.push('');
    lines.push('| Name | Type | Required | Notes |');
    lines.push('|------|------|----------|-------|');
    for (const f of queryFields) lines.push(formatFieldRow(f));
    lines.push('');
  } else if (ep.queryDto) {
    lines.push(`**Query parameters:** \`${ep.queryDto}\` (see DTO)`);
    lines.push('');
  }

  if (ep.bodyDto && registry.has(ep.bodyDto)) {
    const fields = registry.get(ep.bodyDto).fields.filter((f) => f.name !== '_');
    lines.push(`**Body** (\`${ep.bodyDto}\` — JSON)`);
    lines.push('');
    if (fields.length) {
      lines.push('| Name | Type | Required | Notes |');
      lines.push('|------|------|----------|-------|');
      for (const f of fields) lines.push(formatFieldRow(f));
    } else {
      lines.push('_No fields declared (empty / passthrough DTO)._');
    }
    lines.push('');
  } else if (ep.bodyDto) {
    lines.push(`**Body:** \`${ep.bodyDto}\` (JSON)`);
    lines.push('');
  }

  if (ep.multipart) {
    lines.push('**Body** (`multipart/form-data`)');
    lines.push('');
    lines.push('| Name | Type | Required | Notes |');
    lines.push('|------|------|----------|-------|');
    if (ep.bodyDto && registry.has(ep.bodyDto)) {
      for (const f of registry.get(ep.bodyDto).fields) {
        if (f.name === '_') continue;
        lines.push(formatFieldRow(f));
      }
    }
    lines.push(
      '| file field(s) | `binary` / `binary[]` | required | Uploaded via `FileInterceptor` / `FilesInterceptor` |',
    );
    lines.push('');
  }

  if (
    !ep.pathParams.length &&
    !queryFields.length &&
    !ep.queryDto &&
    !ep.bodyDto &&
    !ep.multipart
  ) {
    lines.push('_No path, query, or body parameters._');
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Main ───────────────────────────────────────────────────────────
const registry = buildDtoRegistry();
const controllers = walk(SRC, (n) => n.endsWith('.controller.ts'));
const endpoints = [];

for (const file of controllers) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(SRC, file).replace(/\\/g, '/');
  const ctrlMatch = src.match(/@Controller\((?:'([^']*)'|"([^"]*)")?\)/);
  const base = (ctrlMatch && (ctrlMatch[1] || ctrlMatch[2])) || '';
  const classAdmin = /@Roles\(['"]ADMIN['"]\)/.test(src) && base === 'admin';

  const httpRe = /@(Get|Post|Put|Patch|Delete)\(/g;
  let hm;
  while ((hm = httpRe.exec(src)) !== null) {
    const verb = hm[1].toUpperCase();
    const openParen = hm.index + hm[0].length - 1;
    const closeParen = findMatching(src, openParen);
    if (closeParen < 0) continue;

    const routeArg = src.slice(openParen + 1, closeParen).trim();
    const routeStr = routeArg.match(/^['"]([^'"]*)['"]/);
    const route = routeStr ? routeStr[1] : '';

    const restLine = src.slice(closeParen + 1).match(/^[^\n]*/)?.[0] || '';
    const lineComment = restLine.match(/\/\/\s*(.+)/)?.[1]?.trim() || '';

    let i = closeParen + 1;
    let decoBlock = '';
    while (i < src.length) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith('//', i)) {
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }
      if (src.startsWith('/*', i)) {
        const end = src.indexOf('*/', i);
        i = end < 0 ? src.length : end + 2;
        continue;
      }
      if (src[i] === '@') {
        const start = i;
        i++;
        while (i < src.length && /[\w.]/.test(src[i])) i++;
        if (src[i] === '(') {
          const end = findMatching(src, i);
          i = end < 0 ? src.length : end + 1;
        }
        decoBlock += src.slice(start, i) + '\n';
        continue;
      }
      break;
    }

    const sig = src.slice(i).match(/^(async\s+)?([A-Za-z_]\w*)\s*\(/);
    if (!sig) continue;
    const methodName = sig[2];
    if (['if', 'for', 'while', 'switch', 'catch', 'return'].includes(methodName))
      continue;

    const methodOpen = i + sig[0].length - 1;
    const methodClose = findMatching(src, methodOpen);
    const paramBlock = methodClose > 0 ? src.slice(methodOpen + 1, methodClose) : '';
    const parsed = parseParamBlock(paramBlock);

    const preceding = collectPrecedingDecorators(src, hm.index);
    const publicRoute = /@Public\(\)/.test(preceding);
    const auth = publicRoute ? 'Public' : classAdmin ? 'Admin' : 'Auth';
    const summary =
      extractSummary(preceding + '\n' + decoBlock) ||
      (lineComment && !lineComment.startsWith('SPRINT') ? lineComment : '') ||
      '';

    const fullPath = ('/api/' + [base, route].filter(Boolean).join('/')).replace(
      /\/+/g,
      '/',
    );

    endpoints.push({
      module: base || 'app',
      file: rel,
      method: methodName,
      verb,
      path: fullPath,
      auth,
      description: summary,
      multipart: hasFileUpload(preceding + decoBlock),
      ...parsed,
    });
  }
}

const order = [
  'app',
  'auth',
  'users',
  'onboarding',
  'feed',
  'community',
  'events',
  'housing',
  'roommates',
  'restaurants',
  'shared-spaces',
  'stories',
  'news',
  'challenges',
  'badges',
  'conversations',
  'notifications',
  'saves',
  'settings',
  'admin',
];

const titles = {
  app: 'App / Health',
  auth: 'Auth',
  users: 'Users',
  onboarding: 'Onboarding',
  feed: 'Feed',
  community: 'Community',
  events: 'Events',
  housing: 'Housing',
  roommates: 'Roommates',
  restaurants: 'Food / Restaurants',
  'shared-spaces': 'Shared Spaces',
  stories: 'Stories',
  news: 'News',
  challenges: 'Challenges',
  badges: 'Badges',
  conversations: 'Messaging / Conversations',
  notifications: 'Notifications',
  saves: 'Saves',
  settings: 'Settings',
  admin: 'Admin',
};

const groups = {};
for (const ep of endpoints) {
  if (!groups[ep.module]) groups[ep.module] = [];
  groups[ep.module].push(ep);
}

function paramSummary(ep) {
  const parts = [];
  if (ep.pathParams.length)
    parts.push('path: ' + ep.pathParams.map((p) => p.name).join(', '));
  if (ep.queryDto) parts.push(`query: ${ep.queryDto}`);
  else if (ep.queryNamed.length)
    parts.push('query: ' + ep.queryNamed.map((q) => q.name).join(', '));
  if (ep.bodyDto) parts.push(`body: ${ep.bodyDto}`);
  if (ep.multipart) parts.push('multipart');
  return parts.length ? parts.join(' · ') : '—';
}

let md = `# ComLinkr Backend API Endpoints

> Extracted from NestJS controllers + DTO classes in \`backend/src\`.
> **Global prefix:** \`/api\` · **Default port:** \`4000\` · **Swagger UI:** \`/api/docs\`

## Conventions

| Auth | Meaning |
|------|---------|
| **Public** | Marked \`@Public()\` — no session required |
| **Auth** | Requires valid session cookie (global \`AuthGuard\`) |
| **Admin** | Requires authenticated user with \`ADMIN\` role (\`RolesGuard\`) |

| Note | Detail |
|------|--------|
| Session | Cookie-based (\`express-session\` + Redis). Mobile sends \`Cookie: comlinkr.sid=...\` |
| Response wrap | Global \`TransformInterceptor\` wraps payloads |
| Onboarding | \`OnboardingGuard\` may block incomplete profiles on authenticated routes |
| Validation | Global \`ValidationPipe\` (\`whitelist\`, \`forbidNonWhitelisted\`, \`transform\`) |
| Parameters | Path / query / body fields below are resolved from controller signatures and DTO class properties (including \`PartialType\` / \`OmitType\` inheritance) |

## Quick index

| Module | Base path | Count |
|--------|-----------|-------|
`;

for (const mod of order) {
  if (!groups[mod]) continue;
  const basePath = mod === 'app' ? '/api' : `/api/${mod}`;
  md += `| ${titles[mod] || mod} | \`${basePath}\` | ${groups[mod].length} |\n`;
}
md += `\n**Total: ${endpoints.length} endpoints**\n\n`;

md += `---\n\n## All endpoints\n\n`;
md += `| # | Method | Path | Auth | Parameters | Summary |\n`;
md += `|---|--------|------|------|------------|----------|\n`;
let n = 1;
for (const mod of order) {
  const list = groups[mod];
  if (!list) continue;
  for (const ep of list) {
    const summary = (ep.description || ep.method).replace(/\|/g, '\\|');
    md += `| ${n++} | \`${ep.verb}\` | \`${ep.path}\` | ${ep.auth} | ${paramSummary(ep).replace(/\|/g, '\\|')} | ${summary} |\n`;
  }
}
md += '\n';

for (const mod of order) {
  const list = groups[mod];
  if (!list) continue;
  md += `---\n\n## ${titles[mod] || mod}\n\n`;
  md += `**Controller:** \`${list[0].file}\`\n\n`;

  for (const ep of list) {
    md += `### \`${ep.verb} ${ep.path}\`\n\n`;
    md += `| | |\n|---|---|\n`;
    md += `| **Auth** | ${ep.auth} |\n`;
    md += `| **Handler** | \`${ep.method}\` |\n`;
    if (ep.description) md += `| **Summary** | ${ep.description} |\n`;
    md += '\n';
    md += formatParamsSection(ep, registry);
    md += '\n';
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md);

const withBody = endpoints.filter((e) => e.bodyDto).length;
const withQuery = endpoints.filter((e) => e.queryDto || e.queryNamed.length).length;
const withPath = endpoints.filter((e) => e.pathParams.length).length;
console.log(`Wrote ${endpoints.length} endpoints → ${OUT}`);
console.log(`DTOs indexed: ${registry.size}`);
console.log(`With path params: ${withPath}, query: ${withQuery}, body: ${withBody}`);
console.log(
  'Sample FeedQueryDto fields:',
  registry.get('FeedQueryDto')?.fields.map((f) => f.name),
);
console.log(
  'Sample CreateListingDto fields:',
  registry.get('CreateListingDto')?.fields.map((f) => f.name),
);
console.log(
  'Sample UpdateListingDto fields:',
  registry.get('UpdateListingDto')?.fields.map((f) => f.name),
);
