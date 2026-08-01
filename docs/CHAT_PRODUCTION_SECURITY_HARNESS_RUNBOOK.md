# Production Chat Security Harness Runbook

## Amaç

Bu runbook, güncel canonical chat sözleşmesini production üzerinde doğrulamak
içindir. Harness yalnızca sentetik fixture üretir, tek bir açık transaction
içinde çalışır ve kendi açık ROLLBACK komutuyla biter. SQL harness PASS olmadan
uygulama smoke testine geçilmez.

## Production safety boundaries

- Hedef yalnız production project ref kagv…cuxz'dur. Ref maskeli olarak
  doğrulanamazsa durun; staging, GROUNDLESS veya başka bir project ref
  kullanmayın.
- supabase db push, migration repair, db reset, supabase link ve
  migration-history yazması yasaktır.
- Harness dışında SQL çalıştırmayın; production satırlarını elle
  değiştirmeyin; başarısızlıkta kör tekrar yapmayın.
- psql --single-transaction kullanmayın. Harness kendi BEGIN/ROLLBACK
  sınırına sahiptir.

## Target identity and access setup

Operatör, dashboard ve onaylı change kaydındaki project ref'i maskeli
kagv…cuxz olarak karşılaştırır. Tam ref, URL, JWT, key veya password
terminale ya da loga yazılmaz.

Yalnız session pooler bağlantısı ve kısa ömürlü denetim password environment
değişkeni kullanılır. Connection URL sadece
DIETBRIDGE_PG_SESSION_POOLER_URL environment değişkeninde tutulur; dosyaya,
geçmişe veya output'a kopyalanmaz. İş bitiminde ikisini de silin:

~~~powershell
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:DIETBRIDGE_PG_SESSION_POOLER_URL -ErrorAction SilentlyContinue
~~~

Bu örnek gerçek değer içermez ve bu görev sırasında çalıştırılmamalıdır:

~~~powershell
Get-Content -Raw supabase/tests/chat_security_harness.sql | docker run --rm -i -e PGPASSWORD -e PGSSLMODE=require postgres:17-alpine psql "$env:DIETBRIDGE_PG_SESSION_POOLER_URL" -X -v ON_ERROR_STOP=1 -f -
~~~

## Required migration and schema gate

Read-only preflight, supabase_migrations.schema_migrations içinde aşağıdaki
sekiz migration dosyasının tamamını arar. Herhangi biri eksikse fail-closed durun:

~~~text
20260726090000_chat_conversation_schema.sql
20260726090100_chat_constraints_indexes.sql
20260726090200_chat_rls.sql
20260726090300_chat_rpc.sql
20260727091215_chat_table_privilege_hardening.sql
20260727094415_chat_realtime_publication.sql
20260727131340_chat_legacy_message_text_compatibility.sql
20260728103000_chat_delete_delivery_receipts.sql
~~~

20260727131340 için bu boolean true dönmelidir:

~~~sql
select data_type = 'text'
   and is_nullable = 'YES'
   and column_default is null as message_text_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'chat_messages'
  and column_name = 'message_text';
~~~

message_text hâlâ NOT NULL, tip/default farklı veya satır yoksa harness
çalıştırılmaz.

## Read-only security preflight

Tüm preflight sorguları ON_ERROR_STOP ile ayrı, read-only bir oturumda
çalıştırılır. Sonuçlar yalnız boolean, version ve checksum olacak şekilde
güvenli yerel output'a alınır; ham function tanımı, kullanıcı bilgisi veya
connection değeri loglanmaz.

Preflight aşağıdakilerin her birini fail-closed doğrular:

- chat_conversations, chat_messages, chat_read_states var ve RLS açık;
- anon için chat table privilege yok; authenticated için yalnız SELECT var;
  INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER yok;
- send_chat_message(uuid,uuid,text) ve
  mark_chat_conversation_read(uuid,uuid) SECURITY DEFINER, sabit
  search_path ve beklenen postgres owner ile tanımlı; PUBLIC, anon ve
  service_role execute edemez, yalnız authenticated execute edebilir;
- chat read policy'leri/grant'leri migration sözleşmesiyle aynı ve
  supabase_realtime publication'ında üç chat tablosu da var;
- on_auth_user_created trigger'ı auth.users üzerinde AFTER INSERT FOR
  EACH ROW ve public.handle_new_user() hedefli;
- handle_new_user, auth.users, profiles ve dietitian_clients
  trigger/function kaynaklarında dblink, postgres_fdw, http, pg_net,
  webhook, COPY PROGRAM, ALTER SYSTEM veya transaction dışı network yan etkisi
  yok.

Function/trigger kaynakları ekrana dökülmez. pg_get_functiondef,
pg_get_triggerdef, pg_proc, pg_trigger, pg_policy,
information_schema.role_table_grants, has_table_privilege,
has_function_privilege ve pg_publication_tables üzerinden yalnız boolean
sonuç veya checksum alınır.

## auth.uid() claim mapping gate

Harness'e güvenmeden önce session pooler üzerinde read-only transaction ile
claim eşlemesi doğrulanır. Psql \gset ile rastgele test UUID'si output'a
yazdırılmadan saklanır. Aşağıdaki iki sonuç da true olmalıdır:

~~~sql
begin;
set local role authenticated;
-- request.jwt.claim.sub ve request.jwt.claims.sub aynı sentetik UUID'ye ayarlanır.
select auth.uid() = :'claim_sub'::uuid as authenticated_mapping;
rollback;

begin;
set local role anon;
-- sub boş, role anon olarak ayarlanır.
select auth.uid() is null as anon_mapping;
rollback;
~~~

Production auth.uid() implementation'ı farklı GUC kullanıyorsa önce onun
source/işletim sözleşmesi read-only doğrulanır; mapping ispatlanmadan harness
çalıştırılmaz.

## Harness integrity and safe execution

Çalıştırmadan hemen önce repository checkout'unda SHA-256 alınır ve onaylı
change kaydındaki değerle bire bir karşılaştırılır:

~~~powershell
Get-FileHash -Algorithm SHA256 supabase/tests/chat_security_harness.sql
~~~

Hash farklıysa veya branch/HEAD değişmişse durun. Sadece
supabase/tests/chat_security_harness.sql çalıştırılır. Harness
\set ON_ERROR_STOP on ile başlar, explicit BEGIN içerir, persistent DDL
oluşturmaz, commit etmez ve explicit ROLLBACK ile biter. Docker postgres:17-alpine
örneği dosyayı standard input'tan okur; bağlantı açık transaction sırasında
kapanırsa PostgreSQL rollback uygular.

Baseline öncesi fixture-scope dışında kalacak şekilde chat row count,
migration, RLS/grant/RPC/publication checksum'ları read-only kaydedilir.
Harness output'u erişimi sınırlı yerel dosyaya yönlendirilir. Paylaşmadan önce
e-posta, tam UUID, JWT, connection URL, password, key, message body ve raw RPC
result içermediğini tarayın.

Tam olarak 71 farklı PASS: etiketi ve tek CHAT_SECURITY_HARNESS_PASS marker'ı
beklenir. Herhangi bir FAIL: marker'ı, beklenmeyen SQL error veya eksik marker
başarısızlıktır.

## Read-only postflight and release gate

Harness sonrasında read-only doğrulayın:

- başlangıç/bitiş chat row count'ları eşit;
- auth.users içinde chat-harness+%@example.invalid kalıntısı yok;
- aynı pattern ile ilişkili fixture profile, dietitian_clients,
  conversation, message veya read-state kalıntısı yok;
- migration history, RLS policy checksum'u, chat grants checksum'u, RPC
  definition/grant checksum'u ve Realtime publication membership checksum'u
  başlangıç değerleriyle eşit;
- logda CHAT_SECURITY_HARNESS_PASS var, FAIL: marker'ı yok;
- PGPASSWORD ve pooler URL environment değişkenleri silinmiş.

Global count eşitliği tek başına kanıt değildir: .invalid fixture pattern'i ve
fixture ilişkili kayıtların yokluğu ayrıca doğrulanmalıdır. Postflight
eşleşmezse tekrar denemeyin; output'u, preflight checksum'larını ve değişiklik
penceresini koruyup olayı incelemeye alın.

Preflight, SHA-256, harness output ve postflight kapılarının tamamı başarılı
olmadan web veya mobil chat smoke testine geçmek yasaktır. Her blocker,
message_text nullable sözleşmesi, auth mapping, migration/history, RLS, grant,
RPC, Realtime veya external-side-effect başlığıyla kaydedilir.
