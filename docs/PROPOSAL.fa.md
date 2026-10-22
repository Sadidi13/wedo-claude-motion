# Motion Studio — پیشنهاد محصول و معماری

> ویرایشگر لایه‌محور برای خروجی‌های Claude Motion / Claude Design
> نویسنده: Claude (برای آرش) — نسخهٔ ۱ — مهر ۱۴۰۵ / اکتبر ۲۰۲۶

---

## ۰. خلاصهٔ اجرایی

- **مشکل:** Claude Motion انیمیشن را به‌صورت کد می‌سازد ولی خروجی رسمی‌اش فقط **MP4 فلت** است. وقتی ویدیو را به Adobe یا هر ادیتور دیگری می‌بری، لایه‌ها از بین رفته‌اند و اصلاح دقیق (مثلاً «فقط عنوان را ۰٫۵ ثانیه دیرتر بیاور») یا باید با چت و رندر مجدد کل صحنه انجام شود، یا دستی در After Effects از صفر بازسازی شود.
- **کشف کلیدی:** زیر پوست Claude Motion یک رانتایم کوچک React به اسم `animations.jsx` است: `<Stage>` + `<Sprite start end>` + `useTime()` + `Easing` + `interpolate()`. انیمیشن «تابع خالص زمان» است و با `window.__seek(t)` به هر فریم می‌شود پرید. یعنی **کد همان پروژهٔ لایه‌بندی‌شده است**؛ فقط ابزاری نداریم که آن را به‌صورت لایه نشان دهد.
- **پیشنهاد:** یک وب‌اپ (قابل تبدیل به اپ ویندوز با Tauri) که همین کد را وارد می‌کند، هر المان را به‌صورت **لایه** در پنل لایه‌ها و تایم‌لاین نشان می‌دهد، حذف/اضافه/جابه‌جایی/تغییر زمان را دستی انجام می‌دهد، و برای هر لایه یک دکمهٔ «از کلاد بخواه» دارد که **فقط همان لایه** را با پرامپت بازنویسی می‌کند. خروجی هم خودش رندر می‌گیرد (MP4، WebM با آلفا، MOV ProRes 4444 با آلفا، GIF، PNG sequence).
- **وضعیت:** نسخهٔ MVP همین ریپو است (`pnpm dev`). بخش‌های ساخته‌شده و نقشهٔ راه در بخش ۶ و ۷.

---

## ۱. Claude Motion دقیقاً چیست و چه می‌دهد؟ (تحقیق)

| موضوع | یافته |
|---|---|
| ماهیت | ابزار Anthropic (بتا از ۸ اکتبر ۲۰۲۶). ویدیو با مدل ویدیویی ساخته نمی‌شود؛ Claude **کد** می‌نویسد که متن، چارت، شکل و تصویر را انیمیت می‌کند. |
| دسترسی | فقط پلن‌های **Team و Enterprise** (در Team پیش‌فرض روشن، در Enterprise باید ادمین فعال کند). روی Free/Pro/Max نیست. |
| خروجی رسمی | دکمهٔ Export → **MP4** (بدون صدا، بدون آلفا). Share برای لینک. |
| Hand-off | به Adobe (Firefly Video Editor)، Descript، HeyGen، Higgsfield، invideo، Luma، Runway — همه به‌صورت **MP4**. ابزار Adobe در این سشن هم همین را تأیید می‌کند: `import-claude-motion-from-url` «یک MP4 را از URL وارد می‌کند». |
| ساختار کد | قالب «Stage»: `<Stage width height duration fps background>`، `<Sprite start end>`، `useTime()`، `useSprite() → {localTime, progress}`، `Easing.*`، `interpolate()`، `animate()`. حالت رندر با `?__render=1`؛ هوک‌های `window.__seek(t)` و `window.__videoMeta`. |
| راه گرفتن کد | ۱) در Claude Design: Share → Export → **Project archive (.zip)** یا **Standalone HTML** (داخل zip: `artifact.html` + `manifest.json` + `assets/`). ۲) در چت: از Claude بخواه «کد HTML/JSX همین انیمیشن را بده». ۳) ابزارهای جامعه مثل `claude-video-export` همین فایل‌ها را رندر می‌کنند. |
| محدودیت‌ها | کی‌فریم دستی ندارد، صدا ندارد، فوتیج/آدم نمی‌سازد، پلن مصرف می‌کند. |

**نتیجه برای ما:** به‌جای ویدیو، باید **کد** را از Claude بگیریم. کد لایه دارد؛ ویدیو ندارد.

---

## ۲. گزینه‌ها (و چرا گزینهٔ B را توصیه می‌کنم)

### گزینهٔ A — After Effects به‌عنوان میزبان لایه‌ها (از طریق Higgsfield Bridge MCP)
- **چی هست:** در همین سشن، کانکتور Higgsfield Bridge بیش از ۷۰ ابزار `ae_*` دارد: `ae_build_scene_from_html` (HTML → لایه‌های Shape/Text واقعی در AE)، `ae_add_text_layer`، `ae_set_keyframe`، `ae_apply_effect` و… یعنی Claude می‌تواند مستقیم داخل AE لایه بسازد و ادیت کند.
- **مزیت:** تو AE را بلدی؛ کی‌فریم، افکت، رندر حرفه‌ای همه هست.
- **ایراد:** ۱) حرکت‌های Claude Motion (کد JS) به کی‌فریم AE ترجمه نمی‌شود؛ فقط *فریم ثابت* HTML به لایه تبدیل می‌شود و انیمیشن باید دوباره ساخته شود. ۲) وابسته به پلاگین Higgsfield و AE باز روی ویندوز. ۳) حلقهٔ «لایه را انتخاب کن → پرامپت بده» باید روی ExtendScript سوار شود که شکننده است.
- **کِی مناسب است:** وقتی خروجی نهایی باید در AE کامپوزیت شود (مثلاً روی فوتیج واقعی). به‌عنوان **اکسپورت ثانویه** در نقشهٔ راه نگه می‌داریم.

### گزینهٔ B — ویرایشگر لایه‌محور وب روی همان کد Claude Motion (توصیه‌شده ✅)
- **چی هست:** کد `<Stage>/<Sprite>` منبع حقیقت است. ویرایشگر کد را با Babel پارس می‌کند و هر المان JSX را یک **لایه** با شناسهٔ پایدار (`data-layer-id`) می‌بیند. پیش‌نمایش همان رانتایم است داخل iframe؛ تایم‌لاین `start/end` هر Sprite را نشان می‌دهد و با درگ عوض می‌کند. «از کلاد بخواه» فقط کد همان لایه را می‌فرستد و کد جایگزین را می‌گیرد (patch نقطه‌ای، نه رندر مجدد کل صحنه).
- **مزیت:** ۱) با خروجی واقعی Claude Motion/Design سازگار است (همان قرارداد Stage). ۲) اصلاح دقیق و قابل Undo. ۳) خروجی با **آلفا** (WebM/MOV/PNG) که خود Claude Motion نمی‌دهد → می‌شود روی فوتیج در Premiere/AE گذاشت. ۴) وب است؛ با Tauri می‌شود اپ ویندوز شد. ۵) اگر پلن Team نداری، همین اپ با API خود Claude صحنه می‌سازد (scope = «صحنهٔ جدید»).
- **ایراد:** کی‌فریم گرافیکی مثل AE ندارد (فاز ۳ نقشهٔ راه)؛ پکیج‌های ناشناخته (مثلاً three.js) در پیش‌نمایش پشتیبانی نمی‌شوند مگر اضافه شوند.

### گزینهٔ C — Remotion / HyperFrames / Motion Canvas
- Remotion: بالغ ولی source-available با لایسنس شرکتی؛ فرمت پروژه‌اش با Claude Motion فرق دارد (Composition/Sequence) → باید کد Claude را ترجمه کنیم.
- HyperFrames (HeyGen، Apache 2.0، آوریل ۲۰۲۶): HTML + GSAP → MP4؛ موتور رندر خوبی است ولی ویرایشگر لایه ندارد.
- Motion Canvas / Theatre.js: ادیتور دارند اما فرمت خودشان را می‌خواهند؛ Theatre.js هم مدتی غیرفعال بوده.
- **جمع‌بندی:** هیچ‌کدام کد Claude Motion را مستقیم نمی‌خورند. گزینهٔ B را می‌سازیم و موتور رندر را (مثل claude-video-export و HyperFrames) هدلس Chromium + ffmpeg می‌گذاریم.

### گزینهٔ D — OpenCut / omniclip (ادیتورهای ویدیوی وب متن‌باز)
- ادیتور کلیپ/ترک هستند (برش ویدیو)، نه ادیتور کدِ انیمیشن؛ OpenCut در حال بازنویسی کامل است. مناسب «تدوین» ویدیوی آماده‌اند نه ویرایش لایه‌های Claude Motion. می‌شود بعداً خروجی ما را به آن‌ها داد.

---

## ۳. معماری پیشنهادی (گزینهٔ B)

```
┌──────────────────────── Motion Studio (Next.js 16) ────────────────────────┐
│  Import  ──►  Project { files, entry: scene.jsx, meta }                     │
│   zip/html/jsx          │                                                    │
│                         ▼                                                    │
│            Parser (Babel 8): JSX  ⇄  Layer tree  (data-layer-id پایدار)     │
│                         │  عملیات: delete / duplicate / move / retime /      │
│                         │          hide / rename / wrapInSprite / replace    │
│   ┌─────────────────────┼─────────────────────────────┐                     │
│   ▼                     ▼                             ▼                     │
│ Layers panel        Timeline (Sprite bars)        Inspector                 │
│   (درخت لایه‌ها)      (درگ = start/end)           Properties / Code / Ask Claude│
│                         │                                                    │
│                         ▼  postMessage {load, seek, select, rects}          │
│              Preview iframe  /preview  (رانتایم Stage/Sprite + sucrase)      │
│                                                                              │
│  Ask Claude ──► POST /api/ai/edit {scope: layer|scene|new, layerId, prompt}  │
│                 Claude Opus 5.5 + structured output → {summary, code}        │
│                 اعتبارسنجی (parse + id) → جایگزینی فقط همان لایه → Undo      │
│                                                                              │
│  Export ──► POST /api/export → Chromium هدلس: /preview?job=…&__render=1      │
│             window.__seek(t) فریم‌به‌فریم → ffmpeg → mp4 / webm(α) / mov(α) │
│             / gif / png-sequence                                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

### ۳.۱ مدل داده
- `Project`: فایل‌ها (کد + assetها به‌صورت data URL) + فایل ورودی (`scene.jsx`) + `meta` (عرض/ارتفاع/مدت/fps/پس‌زمینه).
- `LayerNode`: `id`، نام، نوع (sprite/text/image/shape/group/component)، `start/end` (اگر عدد باشد)، بازهٔ مؤثر، hidden/locked، فرزندان، و بازهٔ متنی در سورس.
- **قانون طلایی:** کد منبع حقیقت است؛ لایه‌ها «نما»یی روی کد هستند. هر عملیات UI = یک تغییر کوچک و قابل‌برگشت در متن کد.

### ۳.۲ مثال: حلقهٔ «انتخاب لایه → پرامپت → اصلاح»
1. در پنل لایه‌ها روی **Title** کلیک می‌کنی. ویرایشگر دقیقاً این تکه را از کد برمی‌دارد:
   ```jsx
   <Sprite start={0.5} end={4} data-layer-id="sprite-k3f9x2" data-layer-name="Title">
     {({ progress }) => (
       <h1 style={{ opacity: progress, transform: `translateY(${(1 - Easing.easeOutCubic(progress)) * 40}px)` }}>
         Launch Day
       </h1>
     )}
   </Sprite>
   ```
2. در تب **Ask Claude** می‌نویسی: «عنوان با Easing نرم‌تر بیاد، فونت بزرگ‌تر، و ۰٫۳ ثانیه دیرتر شروع بشه».
3. سرور فقط همین المان + قرارداد رانتایم + متن کامل صحنه (برای کانتکست) را به Claude می‌دهد و خروجی ساخت‌یافته می‌گیرد: `{ summary, code }`.
4. ویرایشگر خروجی را پارس می‌کند، مطمئن می‌شود همان `data-layer-id` حفظ شده و کل صحنه هنوز معتبر است، بعد **فقط همان تکه** جایگزین می‌شود. بقیهٔ کد بایت‌به‌بایت دست‌نخورده می‌ماند. Undo یک کلیک است.
5. تایم‌لاین خودش آپدیت می‌شود (start از ۰٫۵ به ۰٫۸).

### ۳.۳ چرا iframe و postMessage؟
کد کاربر (یا Claude) داخل sandbox اجرا می‌شود تا خطای رانتایم، UI ویرایشگر را نخواباند. ویرایشگر مالک زمان است: هر فریم `seek` می‌فرستد؛ همان صفحهٔ `/preview` را رندرر هدلس هم باز می‌کند، پس «آنچه می‌بینی همان است که اکسپورت می‌شود».

### ۳.۴ انتخاب تکنولوژی
| لایه | انتخاب | دلیل |
|---|---|---|
| فریم‌ورک | Next.js 16 + React 19 + TypeScript | UI و API در یک پروژه؛ کلید API در سرور می‌ماند |
| پارس/ویرایش کد | Babel 8 (parser/traverse/types) | ویرایش دقیق با آفست‌های متن، بدون تغییر بقیهٔ فایل |
| کامپایل در مرورگر | sucrase | سریع و سبک برای JSX |
| وضعیت | Zustand + تاریخچهٔ Undo/Redo | ساده و قابل تست |
| هوش مصنوعی | Anthropic SDK، مدل `claude-opus-5-5`، structured output | خروجی JSON معتبر؛ هزینهٔ هر اصلاح لایه معمولاً چند سنت |
| رندر | playwright-core + Chromium + ffmpeg | همان تکنیک claude-video-export؛ آلفا با PNG + VP9/ProRes |
| ایمپورت | jszip | آرشیو Claude Design |

---

## ۴. جریان کاری طراح (نمونهٔ واقعی)

1. **ساخت در Claude Motion** (یا Claude Design): «ویدیوی ۸ ثانیه‌ای معرفی محصول با ۳ ویژگی و یک چارت».
2. **گرفتن کد:** Share → Export → Project archive (.zip). (اگر Motion فقط MP4 داد، در همان چت بگو: «کد HTML کامل این انیمیشن را بده» و فایل را ذخیره کن.)
3. **Import در Motion Studio:** zip را می‌اندازی؛ لایه‌ها ظاهر می‌شوند: Background، Title، Subtitle، Card 1..3، Chart، Outro.
4. **اصلاح دستی:** Card 3 را حذف می‌کنی؛ Chart را در تایم‌لاین ۱ ثانیه جلو می‌کشی؛ Subtitle را Hide می‌کنی تا بعداً تصمیم بگیری.
5. **اصلاح با کلاد:** Title را انتخاب → «متن را فارسی کن: «روز عرضه»، فونت Vazirmatn، راست‌چین». فقط همان لایه عوض می‌شود.
6. **افزودن لایه:** + Text → یک Sprite جدید در نقطهٔ playhead؛ بعد به کلاد می‌گویی «این را یک lower-third شیک کن».
7. **Export:** WebM با آلفا برای گذاشتن روی فوتیج در Premiere، یا MP4 برای اینستاگرام. 
8. **Save project (.zip)** برای ادامهٔ کار بعداً.

---

## ۵. مقایسهٔ تجربهٔ قبل/بعد

| کار | فقط با Claude Motion | با Motion Studio |
|---|---|---|
| «عنوان ۰٫۵ ثانیه دیرتر» | چت + رندر مجدد کل صحنه، ریسک تغییر چیزهای دیگر | درگ در تایم‌لاین یا یک عدد در Properties |
| حذف یک المان | چت | Delete |
| لایه با آلفا برای AE/Premiere | ندارد (MP4 فلت، پس‌زمینهٔ سیاه) | WebM/MOV/PNG با آلفا |
| پرامپت روی یک بخش | روی کل صحنه اعمال می‌شود | فقط لایهٔ انتخاب‌شده، با Undo |
| ساخت بدون پلن Team | ممکن نیست | «New scene from prompt» با API خودت |

---

## ۶. دامنهٔ MVP (آنچه در این ریپو ساخته شده)

- [x] مدل داده و قراردادها (`src/lib/types.ts`, `docs/CONTRACTS.md`)
- [x] پارسر Babel: کد ⇄ لایه‌ها + ۱۳ عملیات ویرایش + تست
- [x] رانتایم سازگار با Claude Motion (`Stage/Sprite/useTime/Easing/interpolate/animate`) + لودر sucrase + صفحهٔ پیش‌نمایش با پروتکل postMessage
- [x] ویرایشگر: پنل لایه‌ها، بوم با انتخاب کلیکی، تایم‌لاین با درگ، Inspector (Properties / Code / Ask Claude)، Undo/Redo، ذخیرهٔ خودکار
- [x] مسیر هوش مصنوعی: `/api/ai/edit` با اعتبارسنجی و یک بار تلاش مجدد
- [x] اکسپورت: `/api/export` (mp4 / webm-α / mov-α / gif / png-sequence) با نوار پیشرفت
- [x] ایمپورت: zip آرشیو Claude Design، HTML مستقل، JSX خام؛ خروجی zip پروژه
- [x] دو نمونه: `product-launch`، `lower-third`

## ۷. نقشهٔ راه

| فاز | هدف | اقلام |
|---|---|---|
| ۱ (این ریپو) | MVP لایه‌محور + کلاد روی لایه | بالا |
| ۲ | راحتی طراح | ویرایش روی بوم (درگ/ریسایز با نوشتن مقادیر در کد)، پالت Easing بصری، اسکرین‌شات فریم برای کانتکست بصری کلاد، فونت‌های فارسی (Vazirmatn/IRANSans) در Export، صدا (ترک موزیک + sync) |
| ۳ | کی‌فریم | Inspector کی‌فریمی روی `interpolate()`: نمودار مقدار/زمان قابل درگ که کد را بازنویسی می‌کند |
| ۴ | ویندوز | بسته‌بندی Tauri (یک exe، ffmpeg/Chromium همراه) |
| ۵ | پل‌ها | Export به After Effects از طریق Higgsfield Bridge (`ae_build_scene_from_html` برای فریم + کی‌فریم‌های `interpolate` به keyframe)، Lottie برای المان‌های SVG ساده، Figma via `get_motion_context` |

---

## ۸. ریسک‌ها و نکات

1. **دسترسی به Claude Motion:** فقط Team/Enterprise. اگر پلن Pro/Max داری: Claude Design (همان رانتایم Stage) یا ساخت مستقیم در Motion Studio با API.
2. **گرفتن کد به‌جای MP4:** باید از Project archive / Standalone HTML استفاده کنی؛ MP4 قابل بازگشت به لایه نیست (می‌شود به‌عنوان لایهٔ ویدیوی پس‌زمینه وارد کرد — فاز ۲).
3. **کتابخانه‌های خارجی در کد Claude:** پیش‌نمایش فقط `react`، `lucide-react` و فایل‌های پروژه را می‌شناسد؛ اگر Claude از پکیج دیگری استفاده کند، خطا با نام پکیج نشان داده می‌شود و می‌شود با یک پرامپت اصلاح کرد.
4. **هزینهٔ API:** هر اصلاح لایه با Opus 5.5 معمولاً ۱۰ تا ۳۰ هزار توکن ورودی (≈ ۰٫۰۴ تا ۰٫۱۲ دلار) است. کش کردن پرامپت سیستم فعال است.
5. **رندر:** نیاز به Chromium و ffmpeg روی ماشینی که سرور را اجرا می‌کند (در Tauri همراه می‌شود).
6. **فونت فارسی در Export:** باید فونت را به‌صورت فایل در پروژه (assets) یا Google Fonts داشته باشی تا Chromium هدلس آن را ببیند.

## ۹. سؤال‌هایی که جوابت مسیر را عوض می‌کند

1. پلن Claude تو چیست (Pro/Max/Team)؟ → تعیین می‌کند ورودی اصلی zip باشد یا تولید با API.
2. اولویت: اپ ویندوز مستقل یا وب‌اپ محلی کافی است؟ → Tauri در فاز ۴.
3. خروجی اصلی برای کجاست (اینستاگرام/سایت/پرزنتیشن/کامپوزیت در AE)؟ → اولویت فرمت‌ها و آلفا.
4. تایپوگرافی فارسی چقدر مهم است؟ → بستهٔ فونت و RTL در فاز ۲.

## ۱۰. منابع

- راهنمای رسمی: https://support.claude.com/en/articles/17454997-get-started-with-claude-motion
- اعلام رسمی (X): https://x.com/claudeai/status/2108271558170976743
- رانتایم Stage و رندر هدلس: https://github.com/dawoodtrumboo/claude-video-export
- ساختار آرشیو Claude Design: https://opendesigner.io/import-from-claude-design
- HyperFrames (HeyGen): https://github.com/heygen-com/hyperframes
- Theatre.js: https://github.com/theatre-js/theatre · omniclip: https://github.com/omni-media/omniclip · OpenCut: https://github.com/OpenCut-app/OpenCut
- تحلیل‌های جانبی: https://www.eesel.ai/blog/claude-motion · https://dev.to/dishant0406/i-asked-for-a-video-claude-motion-gave-me-an-html-file-459o
