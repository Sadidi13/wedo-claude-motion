# راهنمای کاربری Motion Studio (فارسی)

> ویرایشگر لایه‌محور برای انیمیشن‌های Claude Motion / Claude Design

---

## ۱. راه‌اندازی

```bash
pnpm install
cp .env.example .env.local      # کلید Claude را در ANTHROPIC_API_KEY بگذار
pnpm dev                        # http://localhost:3000
```

| نیازمندی | توضیح |
|---|---|
| Node 22+ و pnpm | اجرای برنامه |
| Chromium / Chrome | برای Export (اگر پیدا نشد، مسیر را در `CHROMIUM_PATH` بگذار) |
| ffmpeg | برای Export (`FFMPEG_PATH` اگر روی PATH نیست) |
| `ANTHROPIC_API_KEY` | فقط برای تب «Ask Claude» |

> کلید API فقط سمت سرور خوانده می‌شود و هیچ‌وقت به مرورگر نمی‌رود.

---

## ۲. گرفتن کد از Claude (به‌جای MP4)

| کجا ساخته‌ای | چه چیزی بگیر | در Motion Studio |
|---|---|---|
| Claude Design | Share → Export → **Project archive (.zip)** | Import → فایل zip را بینداز |
| Claude Design | Share → Export → **Standalone HTML** | Import → فایل html |
| Claude Motion (چت) | بنویس: «کد HTML/JSX کامل همین انیمیشن را بده» و ذخیره کن | Import → فایل html یا jsx |
| پلن Team نداری | تب Ask Claude → حالت **New scene** → توضیح بده | همین‌جا ساخته می‌شود |

**مثال پرامپت در چت Claude:**
> «این انیمیشن را به‌صورت یک فایل HTML کامل با همان `animations.jsx` (Stage/Sprite) به من بده تا در ویرایشگر لایه‌ای بازش کنم.»

فایل MP4 قابل تبدیل به لایه نیست.

---

## ۳. نقشهٔ صفحه

```
┌ نوار بالا: نام پروژه · Import · Export · Save · Undo/Redo · ابعاد/مدت/fps ┐
├───────────┬──────────────────────────────────┬──────────────────────────┤
│ Layers    │  Canvas (پیش‌نمایش زنده)          │ Inspector                │
│ درخت لایه‌ها│  کلیک = انتخاب لایه               │  Properties / Code /     │
│ + Text    │                                  │  Ask Claude              │
│ + Image   │                                  │                          │
│ + Shape   │                                  │                          │
├───────────┴──────────────────────────────────┴──────────────────────────┤
│ Timeline: خط‌کش، playhead، یک ردیف برای هر لایه، نوار هر Sprite قابل درگ │
└─────────────────────────────────────────────────────────────────────────┘
```

- **ترتیب لایه‌ها** مثل After Effects است: لایه‌ای که بالاتر در پنل است، روی بقیه کشیده می‌شود.
- آیکن چشم = مخفی کردن (`data-hidden`)، قفل = جلوگیری از ویرایش تصادفی.
- دابل‌کلیک روی نام = تغییر نام (در کد به‌صورت `data-layer-name` ذخیره می‌شود).

---

## ۴. کارهای روزمره

### ۴.۱ تغییر زمان‌بندی
- در تایم‌لاین نوار Sprite را بکش (جابه‌جایی) یا لبه‌هایش را بکش (trim). به فریم snap می‌شود و از بازهٔ والد بیرون نمی‌رود.
- یا در تب Properties عدد Start/End را بنویس.
- لایه‌ای که Sprite نیست (مثلاً یک `<div>` داخل یک Sprite) زمان والدش را ارث می‌برد؛ با دکمهٔ **Wrap in Sprite** می‌شود زمان مستقل داد.

### ۴.۲ افزودن لایه
- **+ Text / + Image / + Shape** یک Sprite دو ثانیه‌ای در محل playhead می‌سازد.
- بعد می‌توانی همان لایه را انتخاب کنی و با Ask Claude بگویی: «این را یک lower-third شیک کن با انیمیشن ورود از چپ».

### ۴.۳ اصلاح با Claude (نکتهٔ اصلی محصول)
1. لایه را انتخاب کن (پنل، تایم‌لاین یا کلیک روی بوم).
2. تب **Ask Claude** → حالت **Selected layer**.
3. پرامپت بنویس (فارسی هم می‌شود). مثال‌ها:
   - «عنوان ۰٫۳ ثانیه دیرتر بیاید و با easeOutBack بالا بیاید»
   - «رنگ کارت‌ها را به پالت بنفش/فیروزه‌ای تغییر بده و سایهٔ نرم اضافه کن»
   - «متن را فارسی کن: «معرفی نوا» با فونت Vazirmatn و راست‌چین»
4. فقط همان لایه عوض می‌شود؛ بقیهٔ کد بایت‌به‌بایت ثابت می‌ماند. اگر نتیجه را نخواستی: **Undo**.

حالت **Whole scene** برای تغییرات کلی (پالت، ریتم، ترتیب صحنه‌ها) و حالت **New scene** برای ساخت از صفر.

### ۴.۴ ویرایش دستی کد
تب **Code** کد همان لایهٔ انتخاب‌شده را نشان می‌دهد؛ تغییر بده و Apply بزن. با سوییچ «whole scene» کل فایل را می‌بینی. خطای نحوی همان‌جا نمایش داده می‌شود و چیزی خراب نمی‌شود.

### ۴.۵ خروجی گرفتن
| فرمت | کاربرد | آلفا |
|---|---|---|
| MP4 (H.264) | اینستاگرام، سایت، پرزنتیشن | ندارد |
| WebM (VP9) | وب با پس‌زمینهٔ شفاف | دارد |
| MOV (ProRes 4444) | کامپوزیت در Premiere / After Effects | دارد |
| GIF | پیش‌نمایش سبک | ندارد |
| PNG sequence (zip) | هر فریم جداگانه، بالاترین کیفیت | دارد |

گزینه‌ها: fps، مقیاس ۱× یا ۲× (مثلاً 1280×720 → 2560×1440)، بازهٔ in/out، کیفیت. نوار پیشرفت تعداد فریم‌ها را نشان می‌دهد و در پایان لینک دانلود می‌آید.

> برای لایهٔ شفاف، پس‌زمینهٔ Stage را خالی بگذار (Properties → Stage → Background خالی) یا لایهٔ Background را مخفی کن، بعد WebM/MOV با گزینهٔ Transparent بگیر.

### ۴.۶ ذخیره و بازگشت
- هر تغییر خودکار در مرورگر ذخیره می‌شود (localStorage) و دفعهٔ بعد همان پروژه باز می‌شود.
- **Save** یک `.zip` کامل (کد + assetها + manifest) می‌دهد که دوباره Import می‌شود.

---

## ۵. کلیدهای میانبر

| کلید | عمل |
|---|---|
| Space | پخش / توقف |
| ← / → | یک فریم عقب / جلو |
| Shift + ← / → | یک ثانیه |
| Home / End | ابتدا / انتها |
| Delete | حذف لایهٔ انتخاب‌شده |
| Ctrl/Cmd + Z · Shift+Z | Undo · Redo |
| Ctrl/Cmd + D | Duplicate |
| H | مخفی/نمایش |
| Ctrl + چرخ ماوس | زوم تایم‌لاین |

---

## ۶. قواعد کدی که ویرایشگر انتظار دارد (برای وقتی خودت یا Claude کد می‌نویسید)

```jsx
import React from "react";
import { Stage, Sprite, useTime, useSprite, Easing, interpolate, animate } from "./animations.jsx";

export default function Scene() {
  const t = useTime();                       // مجاز: بیرون یا داخل Stage
  return (
    <Stage width={1280} height={720} duration={8} fps={30} background="#0b0b12">
      <Sprite start={0.5} end={4} data-layer-name="Title">
        {({ progress }) => (
          <h1 style={{ opacity: progress, transform: `translateY(${(1 - Easing.easeOutCubic(progress)) * 40}px)` }}>
            سلام
          </h1>
        )}
      </Sprite>
    </Stage>
  );
}
```

- حرکت فقط تابع زمان است: `useTime`, `useSprite`, `interpolate`, `animate`, `Easing`. بدون CSS transition/keyframes، بدون `setTimeout`/`Math.random`.
- ایمپورت‌های مجاز: `react`، `react-dom`، `lucide-react`، `./animations.jsx` و فایل‌های نسبی پروژه (`./Card.jsx`, `./styles.css`, `assets/logo.png`).
- هر المان داخل Stage یک `data-layer-id` پایدار می‌گیرد (خودکار). نام دلخواه با `data-layer-name`.

---

## ۷. مشکلات رایج

| علامت | علت / راه‌حل |
|---|---|
| «Preview error: Unsupported import 'x'» | کد از پکیجی استفاده می‌کند که در پیش‌نمایش نیست. با Ask Claude بگو «بدون x بنویس» یا پکیج را به لودر اضافه کن. |
| تب Ask Claude می‌گوید `Set ANTHROPIC_API_KEY` | کلید را در `.env.local` بگذار و سرور را دوباره اجرا کن. |
| Export خطای Chromium می‌دهد | `CHROMIUM_PATH` را به باینری Chrome/Chromium بده. |
| فونت فارسی در Export افتاده | فونت را به‌صورت فایل در پروژه (assets) یا لینک Google Fonts در `fonts.css` بگذار. |
| لایه‌ای با برچسب `expr` در تایم‌لاین | زمانش با عبارت (نه عدد) نوشته شده؛ از تب Code یا Ask Claude تغییرش بده. |
