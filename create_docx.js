const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, PageBreak, LevelFormat, NumberingLevel,
  convertInchesToTwip, TableLayoutType, VerticalAlign,
  ShadingType, Header, Footer, PageNumber
} = require('docx');
const fs = require('fs');

// ===== Helper functions =====
function bold(text) {
  return new TextRun({ text, bold: true });
}

function normal(text) {
  return new TextRun({ text });
}

function code(text) {
  return new TextRun({ text, font: 'Courier New', size: 20 });
}

function h1(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } }
  });
}

function h2(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 150 }
  });
}

function h3(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 }
  });
}

function p(textRuns, spacing = { before: 60, after: 60 }) {
  const runs = Array.isArray(textRuns) ? textRuns : [normal(textRuns)];
  return new Paragraph({ children: runs, spacing });
}

function bullet(text, level = 0) {
  return new Paragraph({
    children: [normal(text)],
    numbering: { reference: 'bullet-list', level },
    spacing: { before: 30, after: 30 }
  });
}

function checkbox(text, checked = false) {
  return new Paragraph({
    children: [normal((checked ? '☑' : '☐') + ' ' + text)],
    numbering: { reference: 'checkbox-list', level: 0 },
    spacing: { before: 30, after: 30 }
  });
}

function codeBlock(codeText) {
  return new Paragraph({
    children: [code(codeText)],
    spacing: { before: 100, after: 100 },
    indent: { left: convertInchesToTwip(0.3) },
    shading: { type: ShadingType.CLEAR, fill: 'F5F5F5' }
  });
}

function emptyLine() {
  return new Paragraph({ children: [new TextRun('')], spacing: { before: 60, after: 60 } });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

// ===== Table helpers =====
function createTable(headers, rows, widths = []) {
  const headerCells = headers.map((h, i) =>
    new TableCell({
      children: [new Paragraph({ children: [bold(h)], alignment: AlignmentType.CENTER })],
      width: widths[i] ? { size: widths[i], type: WidthType.PERCENTAGE } : undefined,
      shading: { type: ShadingType.CLEAR, fill: 'E8E8E8' },
      verticalAlign: VerticalAlign.CENTER
    })
  );

  const dataRows = rows.map(row =>
    new TableRow({
      children: row.map((cell, i) =>
        new TableCell({
          children: [new Paragraph({
            children: Array.isArray(cell) ? cell : [normal(cell.toString())],
            spacing: { before: 30, after: 30 }
          })],
          width: widths[i] ? { size: widths[i], type: WidthType.PERCENTAGE } : undefined,
          verticalAlign: VerticalAlign.CENTER
        })
      )
    })
  );

  return new Table({
    rows: [new TableRow({ children: headerCells, tableHeader: true }), ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' }
    }
  });
}

// ===== Build document content =====

// Section 0: Tóm tắt yêu cầu
const section0 = [
  h1('0. Tóm tắt yêu cầu (để đối chiếu khi chấm)'),
  createTable(
    ['Hạng mục', 'Yêu cầu bắt buộc'],
    [
      ['Setup', 'README: lệnh tạo DB, migration, seed, reset, chạy server — chạy được trên máy sạch'],
      ['API', '6 endpoint đúng method / path / status'],
      ['Documentation', 'OpenAPI 3.1, đủ mọi status, có example, /docs chạy được'],
      ['Validation', 'Cùng một nguồn schema với spec; request sai không chạm DB'],
      ['Error & logging', 'Mọi lỗi theo error contract (kể cả 500, lỗi của thư viện validator); log kèm request_id'],
      ['Evidence', 'Script chạy lại được cho mọi dòng ma trận nghiệm thu']
    ],
    [25, 75]
  ),
  emptyLine(),
  p([bold('Ngoài phạm vi:'), normal(' đăng ký (/register), checkout, thanh toán, frontend, giữ chỗ tồn kho / race condition.')]),
  p([bold('Bổ sung (yêu cầu thêm):'), normal(' POST /login với user cố định user / 1234 → trả JWT để dùng Bearer Authentication.')])
];

// Section 1: Quyết định kỹ thuật
const section1 = [
  pageBreak(),
  h1('1. Quyết định kỹ thuật (đã chốt)'),
  createTable(
    ['Vấn đề', 'Lựa chọn', 'Ghi chú'],
    [
      ['Runtime', 'Node.js 20+ + TypeScript + Express 4', 'Đã chốt'],
      ['Hướng tiếp cận', 'Contract-first: openapi/openapi.yaml viết tay là nguồn schema duy nhất', 'Đã chốt'],
      ['Validator', 'express-openapi-validator (đọc trực tiếp openapi.yaml)', 'Validate request và response từ cùng file'],
      ['DB', 'SQLite (file data/cart.db), không dùng Docker', 'Máy sạch chỉ cần Node'],
      ['Driver', 'better-sqlite3, SQL thuần', 'API đồng bộ, có db.transaction()'],
      ['Migration', 'File .sql trong migrations/ + runner tự viết', 'Không cần thư viện migration'],
      ['Docs UI', 'Swagger UI (swagger-ui-express) tại /docs', 'Swagger UI v5 hỗ trợ OpenAPI 3.1'],
      ['Auth', 'jsonwebtoken (HS256), secret từ JWT_SECRET', 'User cứng trong code'],
      ['Logging', 'pino + pino-http (+ pino-pretty khi dev)', 'JSON log, có genReqId, redact'],
      ['Evidence', 'vitest + supertest + file requests.http để demo tay', '1 lệnh npm run evidence'],
      ['Vị trí code', 'Đặt thẳng trong Block-1/', 'Đã chốt']
    ],
    [20, 40, 40]
  ),
  emptyLine(),
  h2('Chuyển DDL PostgreSQL trên slide sang SQLite'),
  p('Giữ đúng tên bảng, cột, constraint để GV chấm bằng cùng ma trận; chỉ đổi kiểu dữ liệu:'),
  emptyLine(),
  createTable(
    ['PostgreSQL (slide)', 'SQLite', 'Xử lý'],
    [
      ['uuid', 'TEXT', 'UUID sinh ở app bằng crypto.randomUUID()'],
      ['boolean', 'INTEGER CHECK (is_active IN (0,1))', 'Map sang true/false ở repository'],
      ['integer, text', 'giữ nguyên', ''],
      ['CHECK, UNIQUE, PRIMARY KEY, REFERENCES', 'giữ nguyên', 'Bắt buộc PRAGMA foreign_keys = ON']
    ],
    [35, 30, 35]
  )
];

// Section 2: Cấu trúc response
const section2 = [
  pageBreak(),
  h1('2. Cấu trúc response chung (error contract — slide 10)'),

  h2('2.1 Response thành công'),
  p('Không bọc envelope — trả đúng resource theo spec:'),
  emptyLine(),
  createTable(
    ['Endpoint', 'Body'],
    [
      ['GET /products', 'Mảng Product[]'],
      ['POST /carts, GET /carts/{id}, POST…/items, PATCH…/items/{productId}', 'Object Cart'],
      ['DELETE …/items/{productId}', '204, không body']
    ],
    [40, 60]
  ),
  emptyLine(),
  p([bold('Lưu ý:'), normal(' Mọi response (thành công và lỗi) đều có header X-Request-Id.')]),
  emptyLine(),
  p('Ví dụ Cart response:'),
  codeBlock('{'),
  codeBlock('  "id": "c0000000-0000-4000-8000-000000000001",'),
  codeBlock('  "status": "open",'),
  codeBlock('  "items": ['),
  codeBlock('    { "product_id": "…", "name": "…", "unit_price_cents": 15000, "quantity": 2, "line_total_cents": 30000 }'),
  codeBlock('  ],'),
  codeBlock('  "subtotal_cents": 30000'),
  codeBlock('}'),

  h2('2.2 Response lỗi — một dạng duy nhất cho mọi status 4xx/5xx'),
  codeBlock('{'),
  codeBlock('  "code": "VALIDATION_ERROR",'),
  codeBlock('  "message": "Request body không hợp lệ",'),
  codeBlock('  "details": [{ "field": "quantity", "issue": "must be <= 10" }],'),
  codeBlock('  "request_id": "7f3c2a9e-1b4d-4c8a-9e21-5d6f0a3b8c10"'),
  codeBlock('}'),
  emptyLine(),
  createTable(
    ['Field', 'Kiểu', 'Bắt buộc', 'Quy tắc'],
    [
      ['code', 'string (enum)', '✔', 'Chuỗi cố định để client rẽ nhánh — không bao giờ đổi'],
      ['message', 'string', '✔', 'Chỉ để hiển thị, có thể đổi câu chữ'],
      ['details', '[{ field, issue }]', 'chỉ khi VALIDATION_ERROR', 'field là tên field/param'],
      ['request_id', 'string (uuid)', '✔', 'Trùng với header X-Request-Id và dòng log']
    ],
    [20, 20, 15, 45]
  ),
  emptyLine(),
  h3('Bảng mã lỗi (enum code)'),
  createTable(
    ['Status', 'code', 'Khi nào'],
    [
      ['400', 'VALIDATION_ERROR', 'Sai schema body/path/query, JSON hỏng'],
      ['401', 'INVALID_CREDENTIALS', 'POST /login sai username/password'],
      ['401', 'UNAUTHORIZED', 'Thiếu / sai / hết hạn Bearer token'],
      ['404', 'CART_NOT_FOUND', 'cartId hợp lệ nhưng không có trong DB'],
      ['404', 'ITEM_NOT_FOUND', 'Product không có trong cart (PATCH/DELETE)'],
      ['404', 'NOT_FOUND', 'Route không tồn tại'],
      ['405 / 415', 'METHOD_NOT_ALLOWED / UNSUPPORTED_MEDIA_TYPE', 'Lỗi của validator'],
      ['409', 'CART_CLOSED', 'Ghi vào cart checked_out'],
      ['409', 'ITEM_ALREADY_IN_CART', 'POST item đã có trong cart'],
      ['409', 'INSUFFICIENT_STOCK', 'quantity > stock'],
      ['422', 'PRODUCT_UNAVAILABLE', 'Product không tồn tại hoặc is_active = false'],
      ['500', 'INTERNAL_ERROR', 'Lỗi server/DB — không stack trace, SQL, đường dẫn hay secret']
    ],
    [20, 30, 50]
  ),

  h2('2.3 Authentication (POST /login + Bearer token)'),
  createTable(
    ['Hạng mục', 'Quy định'],
    [
      ['User', 'Cứng trong code: username = "user", password = "1234" — không bảng DB, không /register'],
      ['POST /login', 'Body { username, password }. Đúng → 200 { access_token, token_type, expires_in }; sai → 401'],
      ['Token', 'JWT HS256, sub = "user", hết hạn sau JWT_EXPIRES_IN giây (mặc định 3600)'],
      ['Gửi token', 'Header Authorization: Bearer <access_token>'],
      ['Endpoint cần token', 'POST /carts, GET /carts/{id}, POST/PATCH/DELETE /carts/{id}/items...'],
      ['Endpoint không cần token', 'POST /login, GET /products, /docs, /openapi.yaml'],
      ['Thiếu / sai / hết hạn token', '401 UNAUTHORIZED, đúng error contract'],
      ['So sánh password', 'crypto.timingSafeEqual'],
      ['Log', 'Authorization header và password được redact; không log token']
    ],
    [30, 70]
  )
];

// Section 3: Thứ tự implementation
const section3 = [
  pageBreak(),
  h1('3. Thứ tự implementation'),

  h2('Bước 3.0 — Spike kiểm tra công cụ (15\')'),
  checkbox('Cài express-openapi-validator, thử load spec openapi: 3.1.0 tối thiểu'),
  checkbox('Xác nhận: format: uuid được validate, body "2" không bị ép thành 2, if/then trong schema Error chạy được'),
  checkbox('Xác nhận swagger-ui-express render được spec 3.1'),
  checkbox('Xác nhận better-sqlite3 cài được trên Windows + Node hiện tại'),
  checkbox('Nếu validator không ổn với 3.1 → phương án dự phòng: Ajv 2020 + middleware tự viết'),

  h2('Bước 3.1 — Khởi tạo project trong Block-1/ (10\')'),
  checkbox('package.json, tsconfig.json, .env.example, .gitignore'),
  checkbox('Cấu trúc thư mục theo mẫu đã định'),

  h2('Bước 3.2 — Database: migration + seed + reset (20\')'),
  checkbox('migrations/001_init.sql: products, carts, cart_items theo bảng chuyển đổi'),
  checkbox('scripts/migrate.ts: tạo schema_migrations, chạy các file .sql theo thứ tự'),
  checkbox('Seed với UUID cố định (P1-P5, C_OPEN, C_CLOSED)'),
  checkbox('scripts/reset.ts: xoá file .db → migrate → seed'),
  checkbox('npm scripts: db:migrate, db:seed, db:reset'),

  h2('Bước 3.3 — Viết openapi.yaml (OpenAPI 3.1) — NGUỒN SCHEMA DUY NHẤT (40\')'),
  checkbox('components.schemas: Product, ProductList, AddItemRequest, UpdateItemRequest, CartItem, Cart, Error'),
  checkbox('components.parameters: CartId, ProductId, Limit, Offset'),
  checkbox('components.responses: đủ mọi status với example cho từng code'),
  checkbox('6 operation với operationId, khai báo đủ mọi status'),
  checkbox('Lint spec: npx @redocly/cli lint openapi/openapi.yaml'),

  h2('Bước 3.4a — Auth (bổ sung)'),
  checkbox('src/auth.ts: user cứng, verifyCredentials, signToken, requireAuth'),
  checkbox('src/routes/auth.ts: POST /login'),
  checkbox('Test: login đúng/sai/thiếu field; gọi /carts không token, token rác, token hết hạn'),

  h2('Bước 3.4 — Khung app: request_id, logging, error contract (25\')'),
  checkbox('pino-http với genReqId, X-Request-Id header, redact Authorization/password'),
  checkbox('express.json({ limit: \'100kb\' })'),
  checkbox('Swagger UI tại /docs'),
  checkbox('express-openapi-validator: validateRequests, validateFormats, validateResponses'),
  checkbox('Error handler chung: AppError, lỗi validator, 500 INTERNAL_ERROR'),
  checkbox('Unit test cho error mapper'),

  h2('Bước 3.5 — Repository + service nghiệp vụ (40\')'),
  checkbox('db.ts: better-sqlite3 lazy, PRAGMA foreign_keys = ON, PRAGMA journal_mode = WAL'),
  checkbox('Repositories: listActiveProducts, findProduct, findCart, findCartItem, createCart, insertItem, updateItemQuantity, deleteItem, getCartWithItems'),
  checkbox('cartService: thứ tự kiểm tra theo spec (CART_NOT_FOUND → CART_CLOSED → PRODUCT_UNAVAILABLE...)'),
  checkbox('Bọc kiểm tra + ghi + đọc lại cart trong db.transaction(...)'),

  h2('Bước 3.6 — Routes (20\')'),
  checkbox('GET /products → 200, mảng product active, sắp theo sku, áp limit/offset'),
  checkbox('POST /carts → 201, Location header'),
  checkbox('GET /carts/{cartId} → 200 Cart'),
  checkbox('POST /carts/{cartId}/items → 201 Cart'),
  checkbox('PATCH /carts/{cartId}/items/{productId} → 200 Cart'),
  checkbox('DELETE /carts/{cartId}/items/{productId} → 204'),
  checkbox('Handler không validate lại kiểu (tránh hai nguồn schema)'),

  h2('Bước 3.7 — Evidence: test tự động theo ma trận nghiệm thu (40\')'),
  p('Ma trận nghiệm thu:'),
  createTable(
    ['#', 'Kịch bản', 'Kỳ vọng'],
    [
      ['A1', 'quantity = 0 / 11 / "2"', '400 VALIDATION_ERROR, details chỉ có field quantity'],
      ['A2', 'thiếu product_id', '400, cart_items không đổi'],
      ['A3', 'body có field lạ (vd. price)', '400, DB không đổi'],
      ['A4', 'cartId không phải uuid', '400 VALIDATION_ERROR'],
      ['A5', 'cartId uuid nhưng không tồn tại', '404 CART_NOT_FOUND'],
      ['A6', 'product_id sai định dạng uuid', '400'],
      ['B1', 'thêm P1×2 + P3×3 rồi GET', 'subtotal_cents = 59700'],
      ['B2', 'thêm P5 (ngừng bán)', '422 PRODUCT_UNAVAILABLE'],
      ['B3', 'P2 quantity 6 > stock 5; P4 (stock 0)', '409 INSUFFICIENT_STOCK'],
      ['B4', 'ghi vào C_CLOSED', '409 CART_CLOSED'],
      ['B5', 'thêm trùng product', '409 ITEM_ALREADY_IN_CART'],
      ['B6', 'PATCH/DELETE item không có', '404 ITEM_NOT_FOUND'],
      ['B7', 'POST /carts', '201 + header Location'],
      ['B8', 'GET /products limit 0 / 51 / mặc định', '400 / 400 / mảng ≤ 20'],
      ['C1', 'DB không dùng được', '500 INTERNAL_ERROR, đúng contract'],
      ['C2', 'Mọi response', 'Khớp schema'],
      ['D1', 'POST /login đúng / sai / thiếu field', '200 + token / 401 / 400'],
      ['D2', '/carts... không token, token rác, hết hạn', '401 UNAUTHORIZED'],
      ['C3', 'Log', 'Response lỗi có request_id']
    ],
    [10, 45, 45]
  ),
  emptyLine(),
  checkbox('npm run evidence = db:reset + vitest run'),
  checkbox('scripts/evidence-db-down.ts: khởi động server với DB_PATH hỏng'),
  checkbox('requests.http chứa đủ các request để demo'),

  h2('Bước 3.8 — README (15\')'),
  checkbox('Yêu cầu: Node 20+ (không cần Docker / DB server)'),
  checkbox('Lệnh: npm ci → cp .env.example .env → npm run db:migrate → npm run db:seed → npm run dev'),
  checkbox('Bảng UUID seed + giá để tính tay subtotal'),
  checkbox('Mục Error contract, mục Quyết định & trade-off'),
  checkbox('Kiểm thử trên máy sạch'),

  h2('Bước 3.9 — Chuẩn bị trình bày (10\')'),
  checkbox('Problem → Solution (contract-first, lý do) → Demo'),
  checkbox('Trả lời sẵn câu hỏi về validateResponses')
];

// Section 4: Các bẫy cần kiểm tra
const section4 = [
  pageBreak(),
  h1('4. Các bẫy cần kiểm tra'),
  checkbox('Hai nguồn schema → handler không có validate thủ công trùng spec'),
  checkbox('Lỗi thư viện lọt ra format riêng → A1–A6 kiểm tra đúng shape error contract'),
  checkbox('Tin client → không đọc price từ body; additionalProperties: false chặn luôn'),
  checkbox('Dựa vào lỗi DB (CHECK constraint → 500) → quantity 11 bị validator chặn trước'),
  checkbox('Validator ép "2" → 2 → A1 bắt được'),
  checkbox('format: uuid không được kiểm tra nếu chưa bật → A6'),
  checkbox('SQLite mặc định tắt foreign key → luôn PRAGMA foreign_keys = ON'),
  checkbox('Boolean SQLite là 0/1 → map sang true/false trước khi trả'),
  checkbox('Không log password/token/Authorization → redact')
];

// Section 5: Ghi chú phát sinh
const section5 = [
  pageBreak(),
  h1('5. Ghi chú phát sinh khi implement'),
  bullet('better-sqlite3@13 bị segfault trên Node 22.12 / Windows → ghim better-sqlite3@11'),
  bullet('express được cài là bản 5.x; kiểm tra khi viết app (error handler async, req.query read-only)'),
  bullet('express-openapi-validator: validateFormats: \'full\' đang deprecated → dùng true kèm ajvFormats'),
  bullet('Bảng SQLite tạo bằng STRICT để \'abc\' vào cột INTEGER bị từ chối'),
  bullet('Cart seed C_CLOSED có sẵn 1 item (P1) để thử PATCH/DELETE → 409 CART_CLOSED')
];

// ===== Create document =====
const doc = new Document({
  numbering: {
    config: [
      {
        reference: 'bullet-list',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT },
          { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT, indent: { left: 360, hanging: 180 } }
        ]
      },
      {
        reference: 'checkbox-list',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '☐', alignment: AlignmentType.LEFT }
        ]
      }
    ]
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) },
          margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.25), right: convertInchesToTwip(1) }
        }
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              bold('PLAN — Cart API (Block 1)'),
              normal(' | OpenAPI, validation, error contract, logging')
            ],
            alignment: AlignmentType.LEFT
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              normal('Trang '),
              new TextRun({ children: [PageNumber.CURRENT] }),
              normal(' / '),
              new TextRun({ children: [PageNumber.TOTAL_PAGES] })
            ],
            alignment: AlignmentType.CENTER
          })]
        })
      },
      children: [
        // Title
        new Paragraph({
          children: [bold('PLAN — Cart API')],
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 }
        }),
        new Paragraph({
          children: [normal('Block 1: OpenAPI, validation, error contract, logging')],
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 }
        }),
        new Paragraph({
          children: [
            bold('Nguồn: '), normal('RESTful API có contract OpenAPI, validation và logging.html'),
            bold(' | Tiến độ: '), normal('bước 3.1, 3.2, 3.3 đã xong'),
            bold(' | Trạng thái: '), normal('DRAFT v3')
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 }
        }),

        ...section0,
        ...section1,
        ...section2,
        ...section3,
        ...section4,
        ...section5
      ]
    }
  ]
});

// Write to file
const outputPath = '/sessions/admiring-intelligent-fermi/mnt/PTUDWNC/PLAN_Cart_API.docx';
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outputPath, buffer);
  console.log('✅ Document created: ' + outputPath);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
