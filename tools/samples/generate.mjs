// Генератор вымышленных тестовых PDF в samples/. Запуск: npm run samples
// Шрифт: DejaVu Sans (свободная лицензия), лежит в tools/samples/fonts/.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'samples');
await mkdir(out, { recursive: true });

const regularBytes = await readFile(join(here, 'fonts', 'DejaVuSans.ttf'));
const boldBytes = await readFile(join(here, 'fonts', 'DejaVuSans-Bold.ttf'));

const A4 = [595.28, 841.89];
const LETTER = [612, 792];

async function newDoc(title) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);
  doc.setProducer('e-sign samples');
  const font = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  return { doc, font, bold };
}

function wrap(text, font, size, maxWidth) {
  const lines = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Пишет текст постранично; возвращает последнюю страницу и y после текста. */
function writeFlow(ctx, pageSize, state, blocks) {
  const { doc, font, bold } = ctx;
  const margin = 56;
  const width = pageSize[0] - 2 * margin;
  for (const b of blocks) {
    const f = b.bold ? bold : font;
    const size = b.size ?? 11;
    const lead = size * 1.45;
    for (const line of wrap(b.text, f, size, width)) {
      if (state.y - lead < margin) {
        state.page = doc.addPage(pageSize);
        state.y = pageSize[1] - margin;
        state.footer?.(state.page);
      }
      if (line) {
        const x = b.center ? margin + (width - f.widthOfTextAtSize(line, size)) / 2 : margin + (b.indent ?? 0);
        state.page.drawText(line, { x, y: state.y - size, size, font: f, color: rgb(0.08, 0.08, 0.1) });
      }
      state.y -= lead;
    }
    state.y -= b.after ?? 4;
  }
}

function footer(ctx, label) {
  let n = 0;
  return (page) => {
    n += 1;
    const { width } = page.getSize();
    const text = `${label} · стр. ${n}`;
    page.drawText(text, { x: width / 2 - ctx.font.widthOfTextAtSize(text, 8) / 2, y: 28, size: 8, font: ctx.font, color: rgb(0.45, 0.45, 0.5) });
  };
}

async function build(name, pageSize, title, label, blocks, opts = {}) {
  const ctx = await newDoc(title);
  const page = ctx.doc.addPage(pageSize);
  const state = { page, y: pageSize[1] - 56, footer: footer(ctx, label) };
  state.footer(page);
  writeFlow(ctx, pageSize, state, blocks);
  if (opts.after) await opts.after(ctx);
  await writeFile(join(out, name), await ctx.doc.save());
  console.log('samples/' + name, ctx.doc.getPageCount(), 'стр.');
}

const sign = (who) => [
  { text: `${who}: ____________________   / ____________________ /`, after: 14 },
  { text: 'Подпись                                    расшифровка', size: 8, after: 10 },
];

// 1. Договор оказания услуг — 2 страницы A4
await build('01-dogovor-uslug.pdf', A4, 'Договор оказания услуг № 17/2026 (образец)', 'Договор № 17/2026', [
  { text: 'ДОГОВОР ОКАЗАНИЯ УСЛУГ № 17/2026', bold: true, size: 15, center: true, after: 6 },
  { text: 'г. Ташкент                                                                                                  20 ноября 2026 г.', size: 10, after: 12 },
  { text: 'ООО «Пример Сервис», в лице директора Иванова Ивана Ивановича, действующего на основании Устава, именуемое в дальнейшем «Исполнитель», с одной стороны, и гражданин Петров Пётр Петрович, именуемый в дальнейшем «Заказчик», с другой стороны, заключили настоящий договор о нижеследующем. Все имена и реквизиты в документе вымышлены.', after: 10 },
  { text: '1. Предмет договора', bold: true, size: 12 },
  { text: '1.1. Исполнитель обязуется оказать Заказчику консультационные услуги по подбору оборудования, а Заказчик обязуется принять и оплатить эти услуги.\n1.2. Состав, сроки и стоимость услуг определяются в Приложении № 1, которое является неотъемлемой частью договора.', after: 8 },
  { text: '2. Стоимость и порядок расчётов', bold: true, size: 12 },
  { text: '2.1. Стоимость услуг составляет 1 500 000 (один миллион пятьсот тысяч) сум без НДС.\n2.2. Оплата производится в течение 5 (пяти) рабочих дней с даты подписания акта оказанных услуг.\n2.3. При просрочке оплаты Заказчик уплачивает пеню в размере 0,1% от неоплаченной суммы за каждый день просрочки, но не более 10% от суммы договора.', after: 8 },
  { text: '3. Права и обязанности сторон', bold: true, size: 12 },
  { text: '3.1. Исполнитель обязан оказывать услуги качественно и в срок, сообщать Заказчику о ходе их выполнения.\n3.2. Заказчик обязан предоставлять информацию, необходимую для оказания услуг, и принять результат в течение 3 (трёх) рабочих дней.\n3.3. Каждая из сторон вправе отказаться от договора, уведомив другую сторону не менее чем за 10 календарных дней.', after: 8 },
  { text: '4. Ответственность и разрешение споров', bold: true, size: 12 },
  { text: '4.1. За неисполнение или ненадлежащее исполнение обязательств стороны несут ответственность в соответствии с законодательством.\n4.2. Споры решаются путём переговоров, а при недостижении согласия — в суде по месту нахождения Исполнителя.\n4.3. Договор вступает в силу с момента подписания и действует до полного исполнения обязательств.', after: 8 },
  { text: '5. Заключительные положения', bold: true, size: 12 },
  { text: '5.1. Договор составлен в двух экземплярах, по одному для каждой стороны, оба имеют одинаковую юридическую силу.\n5.2. Любые изменения действительны, если оформлены письменно и подписаны обеими сторонами.', after: 16 },
  { text: '6. Реквизиты и подписи сторон', bold: true, size: 12, after: 8 },
  { text: 'Исполнитель: ООО «Пример Сервис», ИНН 000000000, р/с 00000 000 0 0000 0000 0000, МФО 00000.', after: 18 },
  ...sign('Исполнитель'),
  { text: 'Заказчик: Петров Пётр Петрович, паспорт AA 0000000, выдан ОВД г. Ташкента.', after: 18 },
  ...sign('Заказчик'),
]);

// 2. Акт — 1 страница A4
await build('02-akt-vypolnennyh-rabot.pdf', A4, 'Акт выполненных работ № 17/1 (образец)', 'Акт № 17/1', [
  { text: 'АКТ ВЫПОЛНЕННЫХ РАБОТ № 17/1', bold: true, size: 15, center: true, after: 4 },
  { text: 'к договору оказания услуг № 17/2026 от 20 ноября 2026 г.', size: 10, center: true, after: 14 },
  { text: 'Мы, нижеподписавшиеся, Исполнитель — ООО «Пример Сервис», и Заказчик — Петров Пётр Петрович, составили настоящий акт о том, что услуги, предусмотренные договором, оказаны в полном объёме, в установленные сроки и с надлежащим качеством. Заказчик претензий по объёму, качеству и срокам не имеет.', after: 12 },
  { text: 'Перечень оказанных услуг', bold: true, size: 12 },
  { text: '1. Анализ потребностей Заказчика — 400 000 сум.\n2. Подбор и сравнение вариантов оборудования — 700 000 сум.\n3. Подготовка итогового заключения — 400 000 сум.', after: 8 },
  { text: 'Итого: 1 500 000 (один миллион пятьсот тысяч) сум, НДС не облагается.', bold: true, after: 24 },
  ...sign('Исполнитель'),
  ...sign('Заказчик'),
]);

// 3. Заявление — 1 страница A4, подпись одна внизу
await build('03-zayavlenie.pdf', A4, 'Заявление на выдачу справки (образец)', 'Заявление', [
  { text: 'Директору ООО «Пример Сервис»', size: 11, indent: 280, after: 2 },
  { text: 'Иванову И. И.', size: 11, indent: 280, after: 2 },
  { text: 'от Петрова Петра Петровича', size: 11, indent: 280, after: 2 },
  { text: 'проживающего по адресу: г. Ташкент, ул. Образцовая, д. 1, кв. 1', size: 11, indent: 280, after: 28 },
  { text: 'ЗАЯВЛЕНИЕ', bold: true, size: 15, center: true, after: 12 },
  { text: 'Прошу выдать мне справку о том, что я являюсь клиентом ООО «Пример Сервис», для предоставления по месту требования. Справку прошу подготовить в течение 3 (трёх) рабочих дней.', after: 10 },
  { text: 'Приложение: копия договора № 17/2026 от 20 ноября 2026 г.', after: 30 },
  { text: '20 ноября 2026 г.                                                       ____________________ / Петров П. П. /', after: 10 },
]);

// 4. Длинный документ — 5 страниц A4 (положения), подписи на каждой странице внизу
{
  const clauses = [];
  for (let i = 1; i <= 9; i++) {
    clauses.push({ text: `Раздел ${i}. ${['Общие положения', 'Термины', 'Порядок оказания услуг', 'Права клиента', 'Обязанности компании', 'Защита данных', 'Оплата', 'Ответственность', 'Заключительные положения'][i - 1]}`, bold: true, size: 12 });
    for (let j = 1; j <= 5; j++) {
      clauses.push({ text: `${i}.${j}. Настоящий пункт образца содержит текст для проверки переноса строк и разбиения документа на страницы. Клиент подтверждает, что ознакомился с условиями, понимает их и принимает без возражений. Текст вымышлен и юридической силы не имеет.`, after: 3 });
    }
  }
  await build('04-pravila-obsluzhivaniya-5-stranic.pdf', A4, 'Правила обслуживания клиентов (образец)', 'Правила обслуживания', [
    { text: 'ПРАВИЛА ОБСЛУЖИВАНИЯ КЛИЕНТОВ', bold: true, size: 15, center: true, after: 12 },
    ...clauses,
    ...sign('Клиент'),
  ], {
    after: async (ctx) => {
      // добиваем до пяти страниц, если текста не хватило
      while (ctx.doc.getPageCount() < 5) {
        const p = ctx.doc.addPage(A4);
        p.drawText('Страница оставлена для заметок.', { x: 56, y: A4[1] - 80, size: 11, font: ctx.font });
      }
    },
  });
}

// 5. Letter + одна повёрнутая страница
await build('05-letter-s-povernutoy-stranicey.pdf', LETTER, 'Письмо (Letter) с повёрнутой страницей (образец)', 'Letter', [
  { text: 'LETTER FORMAT SAMPLE / Образец формата Letter', bold: true, size: 14, center: true, after: 10 },
  { text: 'Страница 1 — обычная. Страница 2 — повёрнута на 90° (в просмотрщике открывается боком, как у отсканированных документов). Страница 3 — обычная. Блок подписи на повёрнутой странице должен лечь ровно в то место, куда его нарисовали.', after: 10 },
  ...sign('Клиент'),
], {
  after: async (ctx) => {
    const p2 = ctx.doc.addPage(LETTER);
    p2.drawText('Страница 2 (повёрнута на 90°)', { x: 56, y: LETTER[1] - 80, size: 16, font: ctx.bold });
    p2.drawText('Подпись клиента: ____________________', { x: 56, y: 120, size: 12, font: ctx.font });
    p2.setRotation(degrees(90));
    const p3 = ctx.doc.addPage(LETTER);
    p3.drawText('Страница 3 — обычная', { x: 56, y: LETTER[1] - 80, size: 16, font: ctx.bold });
    p3.drawText('Подпись клиента: ____________________', { x: 56, y: 120, size: 12, font: ctx.font });
  },
});
