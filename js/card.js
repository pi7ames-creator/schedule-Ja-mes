// @ts-check
/**
 * Mini schedule card: one student × one month, drawn on <canvas> → PNG for LINE.
 * Layout: header (name, month) → calendar with a coloured dot on each class day
 * → one row per weekly class (day, time, subject, dates) → summary.
 *
 * Usage: const canvas = await TutorCard.render(opts); canvas.toBlob(...)
 *   opts.schedule = TutorCore.studentMonthSchedule(S, ym, studentId)
 */
(function (root) {
  'use strict';

  const THEMES = {
    light: {
      bg: '#FAFAF8', text: '#1F2328', muted: '#8A9099', faint: '#C9CED4', line: '#ECEEF0',
      accent: '#52796F', accentSoft: '#E8F0EC', red: '#E11D48', redSoft: '#FFE4E6',
      palette: ['#52796F', '#D97706', '#4F6D9A', '#B5547A', '#7C6BB0', '#3F8F8B', '#9A7B4F'],
    },
    dark: {
      bg: '#15181C', text: '#ECEFF1', muted: '#8B949E', faint: '#4A525C', line: '#262B31',
      accent: '#84A98C', accentSoft: '#1E2925', red: '#F87171', redSoft: '#3A1E22',
      palette: ['#84A98C', '#F0A44B', '#7FA3D6', '#E08AAE', '#A99BE0', '#6CC4BE', '#C9A574'],
    },
  };
  const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const DOW_NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const DOW_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const FONT = "'Mali', 'Leelawadee UI', 'Thonburi', 'Noto Sans Thai', sans-serif";

  const W = 1080, P = 72;               // logical width & side padding
  const CELL_H = 108, DOW_H = 56;
  const ROW_H = 150;                    // one weekly-class row in the details list

  const font = (size, weight) => `${weight || 400} ${size}px ${FONT}`;
  const money = (n) => (Number(n) || 0).toLocaleString('th-TH');

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  /** Draw text cut with "…" so it never exceeds maxW. */
  function fitText(ctx, text, x, y, maxW) {
    let t = String(text);
    if (ctx.measureText(t).width > maxW) {
      while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
      t += '…';
    }
    ctx.fillText(t, x, y);
  }
  /** Text with a horizontal strike line (teacher-leave dates). */
  function strikeText(ctx, text, x, y, color, align) {
    const prevAlign = ctx.textAlign;
    ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.fillText(text, x, y);
    const w = ctx.measureText(text).width;
    const x0 = align === 'center' ? x - w / 2 : x;
    const fs = parseFloat(ctx.font.match(/(\d+(?:\.\d+)?)px/)[1]);
    ctx.fillRect(x0 - 3, y - fs * 0.32, w + 6, Math.max(2, fs / 14));
    ctx.textAlign = prevAlign;
    return w;
  }
  /** "วันที่ 3 · 10 · 17 (ลา)" with leave dates in red + struck through; stops with … when out of room. */
  function drawDateList(ctx, T, dates, x, y, maxW) {
    ctx.font = font(28, 400);
    ctx.fillStyle = T.text; ctx.fillText('วันที่ ', x, y);
    let cx = x + ctx.measureText('วันที่ ').width;
    const sep = '  ·  ', sepW = ctx.measureText(sep).width, ell = ctx.measureText('…').width;
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i], day = String(Number(d.date.slice(8)));
      const label = d.status === 'absent' ? `${day} (ลา)` : day;
      const w = ctx.measureText(label).width + (i ? sepW : 0);
      if (cx + w > x + maxW - ell) { ctx.fillStyle = T.muted; ctx.fillText('…', cx, y); return; }
      if (i) { ctx.fillStyle = T.faint; ctx.fillText(sep, cx, y); cx += sepW; }
      if (d.status === 'teacher-off') cx += strikeText(ctx, label, cx, y, T.red);
      else { ctx.fillStyle = d.status === 'absent' ? T.muted : T.text; ctx.fillText(label, cx, y); cx += ctx.measureText(label).width; }
    }
  }

  function dot(ctx, x, y, r, color, hollow) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (hollow) { ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.stroke(); }
    else { ctx.fillStyle = color; ctx.fill(); }
  }

  async function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return;
    try {
      await Promise.all([document.fonts.load(font(40, 400), 'กขค 0123'), document.fonts.load(font(40, 700), 'กขค 0123')]);
    } catch (e) { /* fall back to system Thai font */ }
  }

  /**
   * @param {{studentName:string, ym:string, schedule:any, showPrice?:boolean, theme?:'light'|'dark',
   *          footer?:string, teacherName?:string, scale?:number}} o
   */
  async function render(o) {
    await ensureFonts();
    const T = THEMES[o.theme === 'dark' ? 'dark' : 'light'];
    const sch = o.schedule;
    const [y0, m0] = o.ym.split('-').map(Number);
    const nDays = new Date(y0, m0, 0).getDate();
    const firstDow = new Date(y0, m0 - 1, 1).getDay();
    const rows = Math.ceil((firstDow + nDays) / 7);
    const hasAbsent = sch.items.some((it) => it.dates.some((d) => d.status === 'absent'));
    const footer = (o.footer || '').trim();
    const teacherOff = sch.teacherOff || [];
    const teacherName = (o.teacherName || 'ครู').trim();

    // ---- measure ----
    const headerH = 200;
    const calH = DOW_H + rows * CELL_H;
    const listH = sch.items.length ? 70 + sch.items.length * ROW_H : 120;
    const summaryH = 130;
    const legendH = hasAbsent ? 50 : 0;
    const footerH = footer ? 70 : 0;
    const noticeH = teacherOff.length ? 104 : 0;
    const H = P + headerH + calH + 40 + noticeH + listH + summaryH + legendH + footerH + P - 20;

    const scale = o.scale || 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * scale; canvas.height = H * scale;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    ctx.scale(scale, scale);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);

    // ---- header ----
    let y = P;
    ctx.fillStyle = T.accent; ctx.font = font(28, 700);
    ctx.fillText('ตารางเรียน', P, y + 30);
    const name = o.studentName.startsWith('น้อง') ? o.studentName : `น้อง${o.studentName}`;
    ctx.fillStyle = T.text; ctx.font = font(68, 700);
    fitText(ctx, name, P, y + 112, W - 2 * P - 330);
    ctx.textAlign = 'right';
    ctx.font = font(44, 700); ctx.fillText(TH_MONTHS[m0 - 1], W - P, y + 64);
    ctx.fillStyle = T.muted; ctx.font = font(30, 400); ctx.fillText(String(y0 + 543), W - P, y + 108);
    ctx.textAlign = 'left';
    y += headerH - 40;
    ctx.fillStyle = T.line; ctx.fillRect(P, y, W - 2 * P, 2);
    y += 24;

    // ---- calendar ----
    const cw = (W - 2 * P) / 7;
    ctx.textAlign = 'center';
    ctx.font = font(26, 700);
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = T.muted;
      ctx.fillText(DOW_SHORT[i], P + cw * i + cw / 2, y + 34);
    }
    y += DOW_H;
    for (let d = 1; d <= nDays; d++) {
      const pos = firstDow + d - 1;
      const cx = P + cw * (pos % 7) + cw / 2;
      const top = y + Math.floor(pos / 7) * CELL_H;
      const ds = `${o.ym}-${String(d).padStart(2, '0')}`;
      const marks = sch.byDate[ds] || [];
      const isClass = marks.some((m) => m.status === 'class');
      const allOff = marks.length > 0 && marks.every((m) => m.status === 'teacher-off');
      if (isClass) { // soft pill behind class days
        ctx.fillStyle = T.accentSoft;
        roundRect(ctx, cx - cw / 2 + 8, top + 6, cw - 16, CELL_H - 12, 22); ctx.fill();
      }
      ctx.font = font(36, marks.length ? 700 : 400);
      if (allOff) {
        // normally a class day, but the teacher is on leave: just a red line through the date
        strikeText(ctx, String(d), cx, top + 52, T.red, 'center');
      } else {
        ctx.fillStyle = marks.length ? T.text : T.faint;
        ctx.fillText(String(d), cx, top + 52);
        const shown = marks.filter((m) => m.status !== 'teacher-off').slice(0, 4);
        const gap = 22;
        shown.forEach((m, i) => {
          const dx = cx + (i - (shown.length - 1) / 2) * gap;
          if (m.status === 'teacher-off') return; // only real classes get a dot
          dot(ctx, dx, top + 80, 7.5, T.palette[m.item % T.palette.length], m.status !== 'class');
        });
      }
    }
    ctx.textAlign = 'left';
    y += rows * CELL_H + 24;
    ctx.fillStyle = T.line; ctx.fillRect(P, y, W - 2 * P, 2);
    y += 16;

    // ---- teacher leave notice (only dates this student had class) ----
    if (teacherOff.length) {
      y += 14;
      ctx.fillStyle = T.redSoft;
      roundRect(ctx, P, y, W - 2 * P, 76, 20); ctx.fill();
      dot(ctx, P + 30, y + 38, 8, T.red, false);
      // "พี่เจมส์ลา  วันที่ 10, 17 และ 19 พ.ย."
      const days = teacherOff.map((ds) => String(Number(ds.slice(8))));
      const dayList = days.length > 1 ? `${days.slice(0, -1).join(', ')} และ ${days[days.length - 1]}` : days[0];
      ctx.fillStyle = T.red; ctx.font = font(30, 700);
      const head = `${teacherName}ลา  `;
      ctx.fillText(head, P + 52, y + 49);
      const hw = ctx.measureText(head).width;
      ctx.font = font(30, 400);
      fitText(ctx, `วันที่ ${dayList} ${TH_MONTHS_SHORT[m0 - 1]}`, P + 52 + hw, y + 49, W - 2 * P - 80 - hw);
      y += noticeH - 14;
    }

    // ---- details ----
    if (!sch.items.length) {
      ctx.fillStyle = T.muted; ctx.font = font(32, 400); ctx.textAlign = 'center';
      ctx.fillText('ไม่มีคาบเรียนในเดือนนี้', W / 2, y + 80); ctx.textAlign = 'left';
      y += listH;
    } else {
      ctx.fillStyle = T.muted; ctx.font = font(26, 700);
      ctx.fillText('รายละเอียด', P, y + 44);
      y += 70;
      sch.items.forEach((it, idx) => {
        const color = T.palette[idx % T.palette.length];
        const held = it.dates.filter((d) => d.status === 'class').length;
        dot(ctx, P + 12, y + 30, 12, color, false);
        // line 1: day + time
        ctx.fillStyle = T.text; ctx.font = font(36, 700);
        const day = `วัน${DOW_NAMES[it.dow]}`;
        ctx.fillText(day, P + 40, y + 42);
        const dayW = ctx.measureText(day).width;
        ctx.font = font(34, 400);
        ctx.fillText(`${it.time} น.`, P + 40 + dayW + 18, y + 42);
        // right: count (+ price)
        ctx.textAlign = 'right';
        ctx.font = font(34, 700); ctx.fillStyle = color;
        ctx.fillText(`${held} ครั้ง`, W - P, y + 42);
        if (o.showPrice) {
          ctx.font = font(26, 400); ctx.fillStyle = T.muted;
          ctx.fillText(`${money(it.rate)} บาท/ครั้ง`, W - P, y + 84);
        }
        ctx.textAlign = 'left';
        // line 2: subject (group)
        const subj = [it.subject, it.groupName ? `กลุ่ม ${it.groupName}` : ''].filter(Boolean).join(' · ') || '-';
        ctx.fillStyle = T.muted; ctx.font = font(28, 400);
        fitText(ctx, subj, P + 40, y + 84, W - 2 * P - 40 - (o.showPrice ? 220 : 0));
        // line 3: dates
        drawDateList(ctx, T, it.dates.filter((d) => d.status !== 'teacher-off'), P + 40, y + 124, W - 2 * P - 40);
        y += ROW_H;
        if (idx < sch.items.length - 1) { ctx.fillStyle = T.line; ctx.fillRect(P + 40, y - 12, W - 2 * P - 40, 1.5); }
      });
    }

    // ---- summary ----
    y += 10;
    ctx.fillStyle = T.accentSoft;
    roundRect(ctx, P, y, W - 2 * P, 96, 24); ctx.fill();
    ctx.fillStyle = T.accent; ctx.font = font(32, 700);
    ctx.fillText(`รวม ${sch.classCount} ครั้ง`, P + 32, y + 60);
    if (o.showPrice) {
      ctx.textAlign = 'right'; ctx.font = font(36, 700);
      ctx.fillText(`${money(sch.total)} บาท`, W - P - 32, y + 61);
      ctx.textAlign = 'left';
    }
    y += summaryH;

    if (hasAbsent) {
      ctx.font = font(24, 400); ctx.fillStyle = T.muted;
      dot(ctx, P + 10, y - 2, 8, T.muted, false); ctx.fillText('เรียน', P + 28, y + 6);
      dot(ctx, P + 120, y - 2, 8, T.muted, true); ctx.fillText('ลา (ไม่นับครั้ง)', P + 138, y + 6);
      y += legendH;
    }
    if (footer) {
      ctx.textAlign = 'center'; ctx.font = font(26, 400); ctx.fillStyle = T.muted;
      fitText(ctx, footer, W / 2, y + 20, W - 2 * P);
      ctx.textAlign = 'left';
    }
    return canvas;
  }

  const toBlob = (canvas) => new Promise((res) => canvas.toBlob(res, 'image/png'));

  root.TutorCard = { render, toBlob, THEMES };
})(typeof self !== 'undefined' ? self : this);
