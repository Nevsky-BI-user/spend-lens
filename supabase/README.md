# Supabase для spend-lens — покрокове налаштування

Supabase зберігає агрегати витрат (`usage_days`, `sessions_agg`, `meta`) і список дозволених користувачів (`allowed_users`). Веб-застосунок читає дані через anon-ключ під захистом RLS, колектор пише через service_role-ключ з локальної машини. Уся конфігурація робиться через веб-інтерфейси — CLI Supabase не потрібен.

## 1. Створення безкоштовного проєкту Supabase

1. Відкрийте [supabase.com](https://supabase.com) і увійдіть (можна через GitHub-акаунт).
2. Натисніть **New project**.
3. Заповніть:
   - **Organization** — ваша особиста організація (створюється автоматично).
   - **Project name** — наприклад, `spend-lens`.
   - **Database password** — згенеруйте надійний пароль і збережіть його (для цього проєкту він далі не знадобиться, але без нього не можна відновити прямий доступ до БД).
   - **Region** — найближчий до вас (наприклад, `Central EU (Frankfurt)`).
   - **Plan** — Free.
4. Натисніть **Create new project** і зачекайте одну-дві хвилини, поки проєкт розгорнеться.
5. Відкрийте **Project Settings → API** (у нових версіях панелі — **Project Settings → API Keys** та **Data API**) і випишіть три значення:
   - **Project URL** — виглядає як `https://<project-ref>.supabase.co`; `<project-ref>` — це ідентифікатор проєкту з адреси.
   - **anon (public) key** — публічний ключ для веб-застосунку.
   - **service_role key** — секретний ключ для колектора. Нікому не показуйте.

## 2. Запуск міграції через SQL Editor

1. У лівому меню панелі Supabase відкрийте **SQL Editor**.
2. Натисніть **New query**.
3. Скопіюйте повний вміст файлу [migrations/001_init.sql](migrations/001_init.sql) (лежить поруч із цим README; з кореня репозиторію — `supabase/migrations/001_init.sql`) і вставте в редактор. На Windows найшвидше: `clip < supabase/migrations/001_init.sql` з кореня репозиторію — вміст одразу в буфері обміну. У вставленому тексті замініть заповнювач `<your-email@example.com>` (блок «Seed the owner») на пошту вашого Google-акаунта — це перший рядок `allowed_users`.
4. Натисніть **Run** (або `Ctrl+Enter`).
5. Перевірка: у розділі **Table Editor** мають з'явитися чотири таблиці — `usage_days`, `sessions_agg`, `meta`, `allowed_users`. У таблиці `allowed_users` вже має бути один рядок: `<ваша пошта>` — адреса, яку ви підставили в міграцію.

Міграція ідемпотентна — повторний запуск нічого не зламає.

## 3. Налаштування Google OAuth

### 3.1. Google Cloud Console

1. Відкрийте [console.cloud.google.com](https://console.cloud.google.com) і увійдіть під своїм Google-акаунтом.
2. Створіть новий проєкт (меню вибору проєкту вгорі → **New project**), наприклад `spend-lens-auth`, і перемкніться на нього.
3. Відкрийте **APIs & Services → OAuth consent screen** (у нових версіях консолі цей розділ називається **Google Auth Platform**):
   - **User Type / Audience** — оберіть **External**.
   - **App name** — `spend-lens`.
   - **User support email** — ваша пошта.
   - **Developer contact information** — ваша пошта.
   - Збережіть. Додаткові scopes не потрібні: email і профіль надаються за замовчуванням.
   - Поки застосунок має статус **Testing**, у розділі **Test users** (**Audience → Test users**) додайте `<ваша пошта>` (ту саму адресу, що в `allowed_users`) — інакше Google не пустить на вхід.
4. Відкрийте **APIs & Services → Credentials** (або **Google Auth Platform → Clients**) → **Create Credentials → OAuth client ID**:
   - **Application type** — **Web application**.
   - **Name** — `spend-lens-web`.
   - **Authorized JavaScript origins** — додайте `https://nevsky-bi-user.github.io`.
   - **Authorized redirect URIs** — додайте рівно один рядок (підставте свій `<project-ref>` з кроку 1):

     ```
     https://<project-ref>.supabase.co/auth/v1/callback
     ```

   - Натисніть **Create**.
5. Скопіюйте **Client ID** і **Client secret** — вони потрібні на наступному кроці.

### 3.2. Supabase Dashboard

1. У панелі Supabase відкрийте **Authentication → Providers** (у нових версіях — **Authentication → Sign In / Providers**).
2. Знайдіть **Google**, увімкніть перемикач **Enable**.
3. Вставте **Client ID** і **Client secret** з Google Cloud Console.
4. Переконайтеся, що показаний там **Callback URL** збігається з тим, який ви додали в Google (`https://<project-ref>.supabase.co/auth/v1/callback`).
5. Натисніть **Save**.

## 4. URL-адреси автентифікації (Site URL та Redirect URLs)

1. Відкрийте **Authentication → URL Configuration**.
2. **Site URL**:

   ```
   https://nevsky-bi-user.github.io/spend-lens/
   ```

3. **Additional Redirect URLs** — додайте:

   ```
   https://nevsky-bi-user.github.io/spend-lens/
   ```

   Для локальної розробки можна додатково додати `http://localhost:5173/spend-lens/`.
4. Збережіть.

Без цього кроку після входу через Google користувача перекине не на дашборд, а на `localhost:3000` (значення за замовчуванням).

## 5. Email OTP — запасний спосіб входу

1. Відкрийте **Authentication → Providers → Email** (у нових версіях — **Authentication → Sign In / Up → Email**).
2. Переконайтеся, що провайдер **Email** увімкнено (він активний за замовчуванням).
3. Вимкніть опцію **Confirm email**, якщо хочете входити одразу за одноразовим кодом, або залиште як є — веб-застосунок використовує `signInWithOtp`, тобто вхід за кодом/посиланням з листа, без пароля.
4. Ліміт безкоштовного плану — невелика кількість листів на годину через вбудований SMTP; для одного користувача цього достатньо.

Вхід дозволено лише адресам з таблиці `allowed_users` — будь-хто інший зможе автентифікуватися, але RLS не віддасть йому жодного рядка даних, і застосунок покаже «Доступ заборонено».

## 6. Куди покласти ключі

### 6.1. Локальна машина — `collector/.env`

Скопіюйте `collector/.env.example` у `collector/.env` і заповніть:

```ini
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role-ключ з Project Settings → API>
```

Файл `collector/.env` внесено до `.gitignore` — він ніколи не потрапляє в репозиторій.

### 6.2. GitHub — repo variables для збірки веб-застосунку

Потрібні **variables** (не secrets — значення підставляються у фронтенд-бандл і все одно публічні). Через gh CLI:

```bash
gh variable set VITE_SUPABASE_URL --repo Nevsky-BI-user/spend-lens --body "https://<project-ref>.supabase.co"
gh variable set VITE_SUPABASE_ANON_KEY --repo Nevsky-BI-user/spend-lens --body "<anon-ключ з Project Settings → API>"
```

Перевірка:

```bash
gh variable list --repo Nevsky-BI-user/spend-lens
```

Після цього перезапустіть workflow деплою (push у `main` або **Actions → deploy → Run workflow**), щоб змінні потрапили у збірку.

## 7. Безпека

> **service_role-ключ ніколи не покидає локальну машину.** Він обходить усі RLS-політики і дає повний доступ до бази. Його місце — лише у `collector/.env` (файл у `.gitignore`). Не додавайте його в GitHub variables, secrets, код, логи чи скриншоти. Якщо ключ засвітився — негайно перевипустіть його в **Project Settings → API**.

anon-ключ, навпаки, розрахований на публічність: він потрапляє у фронтенд-бандл на GitHub Pages, а дані захищає RLS — читати таблиці може лише автентифікований користувач, чия пошта є в `allowed_users`. Політик на запис через API немає взагалі: вставляти й оновлювати дані може тільки колектор із service_role-ключем.

## 8. Керування доступом

Щоб надати доступ ще одній людині, додайте її пошту в `allowed_users` через SQL Editor:

```sql
insert into public.allowed_users (email)
values ('friend@example.com')
on conflict (email) do nothing;
```

Щоб забрати доступ:

```sql
delete from public.allowed_users where email = 'friend@example.com';
```

Зміни діють одразу, передеплой не потрібен.
