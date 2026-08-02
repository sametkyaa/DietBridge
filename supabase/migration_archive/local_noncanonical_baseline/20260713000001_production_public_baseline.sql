


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."client_status" AS ENUM (
    'active',
    'inactive',
    'pending',
    'rejected',
    'removed'
);


ALTER TYPE "public"."client_status" OWNER TO "postgres";


CREATE TYPE "public"."meal_type" AS ENUM (
    'breakfast',
    'lunch',
    'dinner',
    'snack'
);


ALTER TYPE "public"."meal_type" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'dietitian',
    'client'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_role"() RETURNS "public"."user_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role
  from public.profiles
  where id = auth.uid()
$$;


ALTER FUNCTION "public"."current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_requested_account_type text;
  v_is_client boolean;
  v_full_name text;
  v_phone text;
begin
  /*
   * Mobil uygulama kayıt sırasında şunu göndermeli:
   *
   * options: {
   *   data: {
   *     account_type: 'client',
   *     full_name: 'Ad Soyad',
   *     phone: '...'
   *   }
   * }
   *
   * Güvenlik nedeniyle metadata üzerinden yalnızca
   * düşük yetkili "client" rolü kabul edilir.
   * "dietitian" metadata değeri burada işlenmez.
   */

  v_requested_account_type := lower(
    coalesce(
      nullif(new.raw_user_meta_data ->> 'account_type', ''),
      nullif(new.raw_user_meta_data ->> 'role', ''),
      ''
    )
  );

  v_is_client := v_requested_account_type = 'client';

  v_full_name := nullif(
    btrim(
      coalesce(
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name',
        ''
      )
    ),
    ''
  );

  v_phone := nullif(
    btrim(
      coalesce(
        new.raw_user_meta_data ->> 'phone',
        ''
      )
    ),
    ''
  );

  insert into public.profiles (
    id,
    email,
    full_name,
    phone,
    role
  )
  values (
    new.id,
    new.email,
    v_full_name,
    v_phone,
    case
      when v_is_client then 'client'::public.user_role
      else null
    end
  )
  on conflict (id)
  do update set
    email = excluded.email,

    full_name = coalesce(
      public.profiles.full_name,
      excluded.full_name
    ),

    phone = coalesce(
      public.profiles.phone,
      excluded.phone
    ),

    role = coalesce(
      public.profiles.role,
      excluded.role
    );

  -- Yalnızca mobil danışan kaydıysa client_profiles oluştur
  if v_is_client then
    insert into public.client_profiles (
      user_id
    )
    values (
      new.id
    )
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_current_user_dietitian"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'dietitian'::public.user_role
  );
$$;


ALTER FUNCTION "public"."is_current_user_dietitian"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_client_profile_system_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.role() = 'authenticated'
     and auth.uid() = old.user_id then

    if new.user_id is distinct from old.user_id then
      raise exception
        'Danışan kullanıcı kimliği değiştirilemez.'
        using errcode = '42501';
    end if;

    if new.compliance_score is distinct from old.compliance_score then
      raise exception
        'Uyum skoru kullanıcı tarafından değiştirilemez.'
        using errcode = '42501';
    end if;

  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."protect_client_profile_system_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_profile_system_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.role() = 'authenticated'
     and auth.uid() = old.id then

    if new.id is distinct from old.id then
      raise exception
        'Profil kullanıcı kimliği değiştirilemez.'
        using errcode = '42501';
    end if;

    if new.role is distinct from old.role then
      raise exception
        'Kullanıcı rolü profil ekranından değiştirilemez.'
        using errcode = '42501';
    end if;

  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."protect_profile_system_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_my_current_weight"("p_weight" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_user_id uuid;
  v_measurement public.measurements%rowtype;
  v_updated_rows integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Bu işlem için oturum açmalısınız.'
      using errcode = '42501';
  end if;

  if p_weight is null then
    raise exception 'Kilo değeri boş bırakılamaz.'
      using errcode = '22023';
  end if;

  if p_weight < 20 or p_weight > 500 then
    raise exception 'Kilo değeri 20 ile 500 kg arasında olmalıdır.'
      using errcode = '22023';
  end if;

  -- Kullanıcının profilindeki güncel kiloyu değiştir
  update public.client_profiles
  set current_weight = p_weight
  where user_id = v_user_id;

  get diagnostics v_updated_rows = row_count;

  if v_updated_rows = 0 then
    raise exception 'Bu kullanıcıya ait danışan profili bulunamadı.'
      using errcode = 'P0002';
  end if;

  -- Aynı gün kayıt varsa yalnızca kilo alanını güncelle.
  -- Bel, kalça, kol gibi diğer ölçümler korunur.
  insert into public.measurements (
    client_id,
    measured_at,
    weight
  )
  values (
    v_user_id,
    current_date,
    p_weight
  )
  on conflict (client_id, measured_at)
  do update
  set
    weight = excluded.weight,
    updated_at = now()
  returning *
  into v_measurement;

  return jsonb_build_object(
    'success', true,
    'client_id', v_measurement.client_id,
    'measured_at', v_measurement.measured_at,
    'weight', v_measurement.weight,
    'measurement_id', v_measurement.id
  );
end;
$$;


ALTER FUNCTION "public"."save_my_current_weight"("p_weight" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_client_profiles_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_client_profiles_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_profiles_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_profiles_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_client_weight_to_measurements"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.current_weight is not null
     and (
       tg_op = 'INSERT'
       or old.current_weight is distinct from new.current_weight
     )
  then
    insert into public.measurements (
      client_id,
      measured_at,
      weight
    )
    values (
      new.user_id,
      current_date,
      new.current_weight
    )
    on conflict (client_id, measured_at)
    do update set
      weight = excluded.weight,
      updated_at = now();
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_client_weight_to_measurements"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activity_levels" (
    "id" smallint NOT NULL,
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" smallint DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."activity_levels" OWNER TO "postgres";


ALTER TABLE "public"."activity_levels" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."activity_levels_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."alcohol_statuses" (
    "id" smallint NOT NULL,
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" smallint DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."alcohol_statuses" OWNER TO "postgres";


ALTER TABLE "public"."alcohol_statuses" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."alcohol_statuses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."appointments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dietitian_id" "uuid",
    "client_id" "uuid",
    "title" "text",
    "date" "date" NOT NULL,
    "time" time without time zone NOT NULL,
    "duration" integer,
    "type" "text",
    "status" "text" DEFAULT 'upcoming'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."appointments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blood_types" (
    "id" smallint NOT NULL,
    "code" "text" NOT NULL
);


ALTER TABLE "public"."blood_types" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."blood_types_id_seq"
    AS smallint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."blood_types_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."blood_types_id_seq" OWNED BY "public"."blood_types"."id";



CREATE TABLE IF NOT EXISTS "public"."body_measurements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "waist_cm" numeric,
    "hip_cm" numeric,
    "arm_cm" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."body_measurements" OWNER TO "postgres";


COMMENT ON TABLE "public"."body_measurements" IS 'DEPRECATED: Veriler public.measurements tablosuna taşınmıştır. Yeni geliştirmelerde kullanılmamalıdır. Mobil uygulamadaki tüm referanslar measurements tablosuna geçirildikten sonra kaldırılacaktır.';



CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sender_id" "uuid",
    "receiver_id" "uuid",
    "message_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_read" boolean DEFAULT false
);


ALTER TABLE "public"."chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_goals" (
    "id" smallint NOT NULL,
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" smallint DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_goals" OWNER TO "postgres";


ALTER TABLE "public"."client_goals" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."client_goals_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."client_medical_conditions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "condition_id" "uuid" NOT NULL,
    "notes" "text",
    "diagnosed_at" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_medical_conditions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_medications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "medication_id" "uuid" NOT NULL,
    "dosage" "text",
    "frequency" "text",
    "notes" "text",
    "started_at" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_medications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_profiles" (
    "user_id" "uuid" NOT NULL,
    "goal" "text",
    "start_weight" numeric,
    "current_weight" numeric,
    "target_weight" numeric,
    "diet_start_date" "date",
    "compliance_score" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "height_cm" integer,
    "blood_type" "text",
    "chronic_conditions" "text"[],
    "medications" "text"[],
    "last_lab_date" "date",
    "activity_level" "text",
    "sleep_hours" numeric,
    "smoking_status" boolean,
    "alcohol_use" boolean,
    "blood_type_id" smallint,
    "alcohol_status" "text",
    "nutrition_type" "text",
    "food_intolerances" "text"[],
    "disliked_foods" "text"[],
    "daily_water_goal_ml" integer,
    "sleep_hours_min" numeric(3,1),
    "sleep_hours_max" numeric(3,1),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activity_level_id" smallint,
    "alcohol_status_id" smallint,
    "nutrition_type_id" smallint,
    "goal_id" smallint,
    CONSTRAINT "client_profiles_compliance_score_check" CHECK ((("compliance_score" IS NULL) OR (("compliance_score" >= (0)::numeric) AND ("compliance_score" <= (100)::numeric)))),
    CONSTRAINT "client_profiles_current_weight_check" CHECK ((("current_weight" IS NULL) OR (("current_weight" >= (20)::numeric) AND ("current_weight" <= (500)::numeric)))),
    CONSTRAINT "client_profiles_daily_water_goal_check" CHECK ((("daily_water_goal_ml" IS NULL) OR (("daily_water_goal_ml" >= 250) AND ("daily_water_goal_ml" <= 10000)))),
    CONSTRAINT "client_profiles_height_cm_check" CHECK ((("height_cm" IS NULL) OR (("height_cm" >= 50) AND ("height_cm" <= 250)))),
    CONSTRAINT "client_profiles_last_lab_date_check" CHECK ((("last_lab_date" IS NULL) OR ("last_lab_date" <= CURRENT_DATE))),
    CONSTRAINT "client_profiles_sleep_hours_max_check" CHECK ((("sleep_hours_max" IS NULL) OR (("sleep_hours_max" >= (0)::numeric) AND ("sleep_hours_max" <= (24)::numeric)))),
    CONSTRAINT "client_profiles_sleep_hours_min_check" CHECK ((("sleep_hours_min" IS NULL) OR (("sleep_hours_min" >= (0)::numeric) AND ("sleep_hours_min" <= (24)::numeric)))),
    CONSTRAINT "client_profiles_sleep_range_check" CHECK ((("sleep_hours_min" IS NULL) OR ("sleep_hours_max" IS NULL) OR ("sleep_hours_min" <= "sleep_hours_max"))),
    CONSTRAINT "client_profiles_target_weight_check" CHECK ((("target_weight" IS NULL) OR (("target_weight" >= (20)::numeric) AND ("target_weight" <= (500)::numeric))))
);


ALTER TABLE "public"."client_profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."client_profiles"."goal" IS 'DEPRECATED: Mobil uygulama goal_id kullanmalıdır. Kod geçişinden sonra kaldırılacaktır.';



COMMENT ON COLUMN "public"."client_profiles"."blood_type" IS 'DEPRECATED: Mobil uygulama blood_type_id kullanmalıdır. Kod geçişinden sonra kaldırılacaktır.';



COMMENT ON COLUMN "public"."client_profiles"."chronic_conditions" IS 'Danışanın kronik rahatsızlıkları. Birden fazla değer text[] olarak saklanır. NULL henüz bilgi girilmediğini belirtir.';



COMMENT ON COLUMN "public"."client_profiles"."medications" IS 'Danışanın kullandığı ilaçlar. Birden fazla değer text[] olarak saklanır. NULL henüz bilgi girilmediğini belirtir.';



COMMENT ON COLUMN "public"."client_profiles"."activity_level" IS 'DEPRECATED: Mobil uygulama activity_level_id kullanmalıdır. Kod geçişinden sonra kaldırılacaktır.';



COMMENT ON COLUMN "public"."client_profiles"."alcohol_status" IS 'DEPRECATED: Mobil uygulama alcohol_status_id kullanmalıdır. Kod geçişinden sonra kaldırılacaktır.';



COMMENT ON COLUMN "public"."client_profiles"."nutrition_type" IS 'DEPRECATED: Mobil uygulama nutrition_type_id kullanmalıdır. Kod geçişinden sonra kaldırılacaktır.';



CREATE TABLE IF NOT EXISTS "public"."daily_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "date" "date" NOT NULL,
    "current_weight" numeric,
    "water_intake" numeric,
    "mood" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."daily_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dietitian_clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dietitian_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "status" "public"."client_status" DEFAULT 'pending'::"public"."client_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "requested_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "removed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "dietitian_clients_status_check" CHECK ((("status")::"text" = ANY (ARRAY['pending'::"text", 'active'::"text", 'rejected'::"text", 'removed'::"text"])))
);


ALTER TABLE "public"."dietitian_clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dietitian_profiles" (
    "user_id" "uuid" NOT NULL,
    "phone" "text",
    "university" "text",
    "graduation_year" integer,
    "experience_years" integer,
    "specialization" "text",
    "bio" "text",
    "diploma_url" "text",
    "is_verified" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "verification_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "verified_at" timestamp with time zone,
    "rejection_reason" "text",
    CONSTRAINT "dietitian_profiles_verification_status_check" CHECK (("verification_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."dietitian_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meal_change_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "dietitian_id" "uuid",
    "plan_date" "date" NOT NULL,
    "meal_slot" "text" NOT NULL,
    "requested_meals" "jsonb",
    "notes" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "meal_change_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."meal_change_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meal_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "dietitian_id" "uuid",
    "plan_date" "date" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."meal_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_id" "uuid",
    "type" "public"."meal_type" NOT NULL,
    "title" "text" NOT NULL,
    "calories" integer,
    "macros" "jsonb",
    "is_eaten" boolean DEFAULT false,
    "photo_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "time" time without time zone,
    "sort_order" integer DEFAULT 0,
    "source" "text" DEFAULT 'manual'::"text",
    "recipe_id" "uuid"
);


ALTER TABLE "public"."meals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."measurements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "measured_at" "date" DEFAULT CURRENT_DATE NOT NULL,
    "weight" numeric(5,2),
    "waist" numeric(5,2),
    "hip" numeric(5,2),
    "arm" numeric(5,2),
    "chest" numeric(5,2),
    "thigh" numeric(5,2),
    "calf" numeric(5,2),
    "neck" numeric(5,2),
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "measurements_positive_values_check" CHECK (((("weight" IS NULL) OR ("weight" >= (0)::numeric)) AND (("waist" IS NULL) OR ("waist" >= (0)::numeric)) AND (("hip" IS NULL) OR ("hip" >= (0)::numeric)) AND (("arm" IS NULL) OR ("arm" >= (0)::numeric)) AND (("chest" IS NULL) OR ("chest" >= (0)::numeric)) AND (("thigh" IS NULL) OR ("thigh" >= (0)::numeric)) AND (("calf" IS NULL) OR ("calf" >= (0)::numeric)) AND (("neck" IS NULL) OR ("neck" >= (0)::numeric))))
);


ALTER TABLE "public"."measurements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."medical_conditions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."medical_conditions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."medications_catalog" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."medications_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nutrition_types" (
    "id" smallint NOT NULL,
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" smallint DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."nutrition_types" OWNER TO "postgres";


ALTER TABLE "public"."nutrition_types" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."nutrition_types_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "full_name" "text",
    "avatar_url" "text",
    "role" "public"."user_role" DEFAULT 'client'::"public"."user_role",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "phone" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."blood_types" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."blood_types_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."activity_levels"
    ADD CONSTRAINT "activity_levels_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."activity_levels"
    ADD CONSTRAINT "activity_levels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alcohol_statuses"
    ADD CONSTRAINT "alcohol_statuses_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."alcohol_statuses"
    ADD CONSTRAINT "alcohol_statuses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blood_types"
    ADD CONSTRAINT "blood_types_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."blood_types"
    ADD CONSTRAINT "blood_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."body_measurements"
    ADD CONSTRAINT "body_measurements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_goals"
    ADD CONSTRAINT "client_goals_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."client_goals"
    ADD CONSTRAINT "client_goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_medical_conditions"
    ADD CONSTRAINT "client_medical_conditions_client_id_condition_id_key" UNIQUE ("client_id", "condition_id");



ALTER TABLE ONLY "public"."client_medical_conditions"
    ADD CONSTRAINT "client_medical_conditions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_medications"
    ADD CONSTRAINT "client_medications_client_id_medication_id_key" UNIQUE ("client_id", "medication_id");



ALTER TABLE ONLY "public"."client_medications"
    ADD CONSTRAINT "client_medications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."daily_logs"
    ADD CONSTRAINT "daily_logs_client_id_date_key" UNIQUE ("client_id", "date");



ALTER TABLE ONLY "public"."daily_logs"
    ADD CONSTRAINT "daily_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dietitian_clients"
    ADD CONSTRAINT "dietitian_clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dietitian_profiles"
    ADD CONSTRAINT "dietitian_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."meal_change_requests"
    ADD CONSTRAINT "meal_change_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meal_plans"
    ADD CONSTRAINT "meal_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meals"
    ADD CONSTRAINT "meals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."measurements"
    ADD CONSTRAINT "measurements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."medical_conditions"
    ADD CONSTRAINT "medical_conditions_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."medical_conditions"
    ADD CONSTRAINT "medical_conditions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."medications_catalog"
    ADD CONSTRAINT "medications_catalog_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."medications_catalog"
    ADD CONSTRAINT "medications_catalog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nutrition_types"
    ADD CONSTRAINT "nutrition_types_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."nutrition_types"
    ADD CONSTRAINT "nutrition_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "dietitian_clients_dietitian_client_unique" ON "public"."dietitian_clients" USING "btree" ("dietitian_id", "client_id");



CREATE INDEX "idx_chat_sender_receiver" ON "public"."chat_messages" USING "btree" ("sender_id", "receiver_id");



CREATE INDEX "idx_client_medical_conditions_client" ON "public"."client_medical_conditions" USING "btree" ("client_id");



CREATE INDEX "idx_client_medical_conditions_condition" ON "public"."client_medical_conditions" USING "btree" ("condition_id");



CREATE INDEX "idx_client_medications_client" ON "public"."client_medications" USING "btree" ("client_id");



CREATE INDEX "idx_client_medications_medication" ON "public"."client_medications" USING "btree" ("medication_id");



CREATE INDEX "idx_daily_logs_client" ON "public"."daily_logs" USING "btree" ("client_id");



CREATE INDEX "idx_dietitian_clients" ON "public"."dietitian_clients" USING "btree" ("dietitian_id", "client_id");



CREATE INDEX "idx_meal_change_requests_client_id" ON "public"."meal_change_requests" USING "btree" ("client_id");



CREATE INDEX "idx_meal_change_requests_dietitian_id" ON "public"."meal_change_requests" USING "btree" ("dietitian_id");



CREATE INDEX "idx_meal_change_requests_plan_date" ON "public"."meal_change_requests" USING "btree" ("plan_date");



CREATE INDEX "idx_meal_change_requests_status" ON "public"."meal_change_requests" USING "btree" ("status");



CREATE INDEX "idx_meal_plans_client" ON "public"."meal_plans" USING "btree" ("client_id");



CREATE INDEX "idx_meals_plan_id_sort_order" ON "public"."meals" USING "btree" ("plan_id", "sort_order");



CREATE INDEX "idx_meals_plan_id_time" ON "public"."meals" USING "btree" ("plan_id", "time");



CREATE INDEX "idx_measurements_client_id" ON "public"."measurements" USING "btree" ("client_id");



CREATE INDEX "idx_measurements_measured_at" ON "public"."measurements" USING "btree" ("measured_at" DESC);



CREATE UNIQUE INDEX "measurements_client_date_unique" ON "public"."measurements" USING "btree" ("client_id", "measured_at");



CREATE UNIQUE INDEX "one_pending_or_active_dietitian_per_client" ON "public"."dietitian_clients" USING "btree" ("client_id") WHERE ("status" = ANY (ARRAY['pending'::"public"."client_status", 'active'::"public"."client_status"]));



CREATE UNIQUE INDEX "one_pending_or_active_relation_per_dietitian_client" ON "public"."dietitian_clients" USING "btree" ("dietitian_id", "client_id") WHERE ("status" = ANY (ARRAY['pending'::"public"."client_status", 'active'::"public"."client_status"]));



CREATE INDEX "profiles_email_idx" ON "public"."profiles" USING "btree" ("email");



CREATE OR REPLACE TRIGGER "trg_client_profiles_updated_at" BEFORE UPDATE ON "public"."client_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_client_profiles_updated_at"();



CREATE OR REPLACE TRIGGER "trg_meal_change_requests_updated_at" BEFORE UPDATE ON "public"."meal_change_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_measurements_updated_at" BEFORE UPDATE ON "public"."measurements" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_profiles_updated_at"();



CREATE OR REPLACE TRIGGER "trg_protect_client_profile_system_fields" BEFORE UPDATE ON "public"."client_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."protect_client_profile_system_fields"();



CREATE OR REPLACE TRIGGER "trg_protect_profile_system_fields" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."protect_profile_system_fields"();



CREATE OR REPLACE TRIGGER "trg_sync_client_weight_to_measurements" AFTER INSERT OR UPDATE OF "current_weight" ON "public"."client_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."sync_client_weight_to_measurements"();



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_dietitian_id_fkey" FOREIGN KEY ("dietitian_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."body_measurements"
    ADD CONSTRAINT "body_measurements_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."client_medical_conditions"
    ADD CONSTRAINT "client_medical_conditions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_medical_conditions"
    ADD CONSTRAINT "client_medical_conditions_condition_id_fkey" FOREIGN KEY ("condition_id") REFERENCES "public"."medical_conditions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_medications"
    ADD CONSTRAINT "client_medications_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_medications"
    ADD CONSTRAINT "client_medications_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "public"."medications_catalog"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_activity_level_id_fkey" FOREIGN KEY ("activity_level_id") REFERENCES "public"."activity_levels"("id");



ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_alcohol_status_id_fkey" FOREIGN KEY ("alcohol_status_id") REFERENCES "public"."alcohol_statuses"("id");



ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_blood_type_id_fkey" FOREIGN KEY ("blood_type_id") REFERENCES "public"."blood_types"("id");



ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "public"."client_goals"("id");



ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_nutrition_type_id_fkey" FOREIGN KEY ("nutrition_type_id") REFERENCES "public"."nutrition_types"("id");



ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_logs"
    ADD CONSTRAINT "daily_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."dietitian_clients"
    ADD CONSTRAINT "dietitian_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."dietitian_clients"
    ADD CONSTRAINT "dietitian_clients_dietitian_id_fkey" FOREIGN KEY ("dietitian_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."dietitian_profiles"
    ADD CONSTRAINT "dietitian_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meal_change_requests"
    ADD CONSTRAINT "meal_change_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meal_change_requests"
    ADD CONSTRAINT "meal_change_requests_dietitian_id_fkey" FOREIGN KEY ("dietitian_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."meal_plans"
    ADD CONSTRAINT "meal_plans_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."meal_plans"
    ADD CONSTRAINT "meal_plans_dietitian_id_fkey" FOREIGN KEY ("dietitian_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."meals"
    ADD CONSTRAINT "meals_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."measurements"
    ADD CONSTRAINT "measurements_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Authenticated users can view activity levels" ON "public"."activity_levels" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view alcohol statuses" ON "public"."alcohol_statuses" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view blood types" ON "public"."blood_types" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view client goals" ON "public"."client_goals" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view medical conditions" ON "public"."medical_conditions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view medications catalog" ON "public"."medications_catalog" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view nutrition types" ON "public"."nutrition_types" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Clients can manage own medical conditions" ON "public"."client_medical_conditions" TO "authenticated" USING (("auth"."uid"() = "client_id")) WITH CHECK (("auth"."uid"() = "client_id"));



CREATE POLICY "Clients can manage own medications" ON "public"."client_medications" TO "authenticated" USING (("auth"."uid"() = "client_id")) WITH CHECK (("auth"."uid"() = "client_id"));



CREATE POLICY "Clients can update own meal completion" ON "public"."meals" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."meal_plans" "mp"
  WHERE (("mp"."id" = "meals"."plan_id") AND ("mp"."client_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."meal_plans" "mp"
  WHERE (("mp"."id" = "meals"."plan_id") AND ("mp"."client_id" = "auth"."uid"())))));



CREATE POLICY "Clients can view meals of own plans" ON "public"."meals" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."meal_plans" "mp"
  WHERE (("mp"."id" = "meals"."plan_id") AND ("mp"."client_id" = "auth"."uid"())))));



CREATE POLICY "Clients can view own meal plans" ON "public"."meal_plans" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "client_id"));



CREATE POLICY "Dietitians can delete meals of own plans" ON "public"."meals" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."meal_plans" "mp"
  WHERE (("mp"."id" = "meals"."plan_id") AND ("mp"."dietitian_id" = "auth"."uid"())))));



CREATE POLICY "Dietitians can delete own meal plans" ON "public"."meal_plans" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "dietitian_id"));



CREATE POLICY "Dietitians can insert meals into own plans" ON "public"."meals" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."meal_plans" "mp"
  WHERE (("mp"."id" = "meals"."plan_id") AND ("mp"."dietitian_id" = "auth"."uid"())))));



CREATE POLICY "Dietitians can insert own meal plans" ON "public"."meal_plans" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "dietitian_id") AND (EXISTS ( SELECT 1
   FROM "public"."dietitian_clients" "dc"
  WHERE (("dc"."client_id" = "meal_plans"."client_id") AND ("dc"."dietitian_id" = "auth"."uid"()) AND ("dc"."status" = 'active'::"public"."client_status"))))));



CREATE POLICY "Dietitians can update meals of own plans" ON "public"."meals" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."meal_plans" "mp"
  WHERE (("mp"."id" = "meals"."plan_id") AND ("mp"."dietitian_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."meal_plans" "mp"
  WHERE (("mp"."id" = "meals"."plan_id") AND ("mp"."dietitian_id" = "auth"."uid"())))));



CREATE POLICY "Dietitians can update own meal plans" ON "public"."meal_plans" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "dietitian_id")) WITH CHECK (("auth"."uid"() = "dietitian_id"));



CREATE POLICY "Dietitians can update own meal rows" ON "public"."meals" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."meal_plans" "mp"
  WHERE (("mp"."id" = "meals"."plan_id") AND ("mp"."dietitian_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."meal_plans" "mp"
  WHERE (("mp"."id" = "meals"."plan_id") AND ("mp"."dietitian_id" = "auth"."uid"())))));



CREATE POLICY "Dietitians can view assigned client measurements" ON "public"."measurements" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."dietitian_clients" "dc"
  WHERE (("dc"."client_id" = "measurements"."client_id") AND ("dc"."dietitian_id" = "auth"."uid"()) AND ("dc"."status" = 'active'::"public"."client_status")))));



CREATE POLICY "Dietitians can view assigned client medical conditions" ON "public"."client_medical_conditions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."dietitian_clients" "dc"
  WHERE (("dc"."client_id" = "client_medical_conditions"."client_id") AND ("dc"."dietitian_id" = "auth"."uid"()) AND ("dc"."status" = 'active'::"public"."client_status")))));



CREATE POLICY "Dietitians can view assigned client medications" ON "public"."client_medications" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."dietitian_clients" "dc"
  WHERE (("dc"."client_id" = "client_medications"."client_id") AND ("dc"."dietitian_id" = "auth"."uid"()) AND ("dc"."status" = 'active'::"public"."client_status")))));



CREATE POLICY "Dietitians can view assigned client profiles" ON "public"."client_profiles" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."dietitian_clients" "dc"
  WHERE (("dc"."client_id" = "client_profiles"."user_id") AND ("dc"."dietitian_id" = "auth"."uid"()) AND ("dc"."status" = 'active'::"public"."client_status")))));



CREATE POLICY "Dietitians can view client profiles for linking" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("role" = 'client'::"public"."user_role") AND "public"."is_current_user_dietitian"()));



CREATE POLICY "Dietitians can view meals of own plans" ON "public"."meals" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."meal_plans" "mp"
  WHERE (("mp"."id" = "meals"."plan_id") AND ("mp"."dietitian_id" = "auth"."uid"())))));



CREATE POLICY "Dietitians can view own meal plans" ON "public"."meal_plans" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "dietitian_id"));



CREATE POLICY "Users can insert own body measurements" ON "public"."body_measurements" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "client_id"));



CREATE POLICY "Users can insert own client profile" ON "public"."client_profiles" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own daily logs" ON "public"."daily_logs" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "client_id"));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can select own meal plans" ON "public"."meal_plans" FOR SELECT TO "authenticated" USING ((("client_id" = "auth"."uid"()) OR ("dietitian_id" = "auth"."uid"())));



CREATE POLICY "Users can select own meal rows" ON "public"."meals" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."meal_plans" "mp"
  WHERE (("mp"."id" = "meals"."plan_id") AND (("mp"."client_id" = "auth"."uid"()) OR ("mp"."dietitian_id" = "auth"."uid"()))))));



CREATE POLICY "Users can update own body measurements" ON "public"."body_measurements" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "client_id")) WITH CHECK (("auth"."uid"() = "client_id"));



CREATE POLICY "Users can update own client profile" ON "public"."client_profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own daily logs" ON "public"."daily_logs" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "client_id")) WITH CHECK (("auth"."uid"() = "client_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can view own body measurements" ON "public"."body_measurements" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "client_id"));



CREATE POLICY "Users can view own client profile" ON "public"."client_profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own daily logs" ON "public"."daily_logs" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "client_id"));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."activity_levels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alcohol_statuses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blood_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."body_measurements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_goals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_medical_conditions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_medications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_update_own_pending_request" ON "public"."dietitian_clients" FOR UPDATE TO "authenticated" USING ((("client_id" = "auth"."uid"()) AND ("status" = 'pending'::"public"."client_status"))) WITH CHECK ((("client_id" = "auth"."uid"()) AND ("status" = ANY (ARRAY['active'::"public"."client_status", 'rejected'::"public"."client_status"])) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND (("p"."role")::"text" = 'client'::"text"))))));



ALTER TABLE "public"."daily_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dietitian_clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dietitian_clients_select_own" ON "public"."dietitian_clients" FOR SELECT TO "authenticated" USING ((("dietitian_id" = "auth"."uid"()) OR ("client_id" = "auth"."uid"())));



CREATE POLICY "dietitians_create_pending_client_request" ON "public"."dietitian_clients" FOR INSERT TO "authenticated" WITH CHECK ((("dietitian_id" = "auth"."uid"()) AND ("status" = 'pending'::"public"."client_status") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND (("p"."role")::"text" = 'dietitian'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "c"
  WHERE (("c"."id" = "dietitian_clients"."client_id") AND (("c"."role")::"text" = 'client'::"text"))))));



CREATE POLICY "dietitians_remove_own_connection" ON "public"."dietitian_clients" FOR UPDATE TO "authenticated" USING ((("dietitian_id" = "auth"."uid"()) AND ("status" = ANY (ARRAY['pending'::"public"."client_status", 'active'::"public"."client_status"])))) WITH CHECK ((("dietitian_id" = "auth"."uid"()) AND ("status" = 'removed'::"public"."client_status")));



ALTER TABLE "public"."meal_change_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "meal_change_requests_insert_client" ON "public"."meal_change_requests" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "client_id"));



CREATE POLICY "meal_change_requests_select_own" ON "public"."meal_change_requests" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "client_id") OR ("auth"."uid"() = "dietitian_id")));



CREATE POLICY "meal_change_requests_update_parties" ON "public"."meal_change_requests" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "client_id") OR ("auth"."uid"() = "dietitian_id"))) WITH CHECK ((("auth"."uid"() = "client_id") OR ("auth"."uid"() = "dietitian_id")));



ALTER TABLE "public"."meal_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."measurements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "measurements_delete_own" ON "public"."measurements" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "client_id"));



CREATE POLICY "measurements_insert_own" ON "public"."measurements" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "client_id"));



CREATE POLICY "measurements_select_own" ON "public"."measurements" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "client_id"));



CREATE POLICY "measurements_update_own" ON "public"."measurements" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "client_id")) WITH CHECK (("auth"."uid"() = "client_id"));



ALTER TABLE "public"."medical_conditions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."medications_catalog" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nutrition_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_current_user_dietitian"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_current_user_dietitian"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_current_user_dietitian"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_current_user_dietitian"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_client_profile_system_fields"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_client_profile_system_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_client_profile_system_fields"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_profile_system_fields"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_profile_system_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_profile_system_fields"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_my_current_weight"("p_weight" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_my_current_weight"("p_weight" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_my_current_weight"("p_weight" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_client_profiles_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_client_profiles_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_client_profiles_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_profiles_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_profiles_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_profiles_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_client_weight_to_measurements"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_client_weight_to_measurements"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_client_weight_to_measurements"() TO "service_role";



GRANT ALL ON TABLE "public"."activity_levels" TO "anon";
GRANT ALL ON TABLE "public"."activity_levels" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_levels" TO "service_role";



GRANT ALL ON SEQUENCE "public"."activity_levels_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."activity_levels_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."activity_levels_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."alcohol_statuses" TO "anon";
GRANT ALL ON TABLE "public"."alcohol_statuses" TO "authenticated";
GRANT ALL ON TABLE "public"."alcohol_statuses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."alcohol_statuses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."alcohol_statuses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."alcohol_statuses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."appointments" TO "anon";
GRANT ALL ON TABLE "public"."appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointments" TO "service_role";



GRANT ALL ON TABLE "public"."blood_types" TO "anon";
GRANT ALL ON TABLE "public"."blood_types" TO "authenticated";
GRANT ALL ON TABLE "public"."blood_types" TO "service_role";



GRANT ALL ON SEQUENCE "public"."blood_types_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."blood_types_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."blood_types_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."body_measurements" TO "anon";
GRANT ALL ON TABLE "public"."body_measurements" TO "authenticated";
GRANT ALL ON TABLE "public"."body_measurements" TO "service_role";



GRANT ALL ON TABLE "public"."chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";



GRANT ALL ON TABLE "public"."client_goals" TO "anon";
GRANT ALL ON TABLE "public"."client_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."client_goals" TO "service_role";



GRANT ALL ON SEQUENCE "public"."client_goals_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."client_goals_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."client_goals_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."client_medical_conditions" TO "anon";
GRANT ALL ON TABLE "public"."client_medical_conditions" TO "authenticated";
GRANT ALL ON TABLE "public"."client_medical_conditions" TO "service_role";



GRANT ALL ON TABLE "public"."client_medications" TO "anon";
GRANT ALL ON TABLE "public"."client_medications" TO "authenticated";
GRANT ALL ON TABLE "public"."client_medications" TO "service_role";



GRANT ALL ON TABLE "public"."client_profiles" TO "anon";
GRANT ALL ON TABLE "public"."client_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."client_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."daily_logs" TO "anon";
GRANT ALL ON TABLE "public"."daily_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_logs" TO "service_role";



GRANT ALL ON TABLE "public"."dietitian_clients" TO "anon";
GRANT ALL ON TABLE "public"."dietitian_clients" TO "authenticated";
GRANT ALL ON TABLE "public"."dietitian_clients" TO "service_role";



GRANT ALL ON TABLE "public"."dietitian_profiles" TO "anon";
GRANT ALL ON TABLE "public"."dietitian_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."dietitian_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."meal_change_requests" TO "anon";
GRANT ALL ON TABLE "public"."meal_change_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."meal_change_requests" TO "service_role";



GRANT ALL ON TABLE "public"."meal_plans" TO "anon";
GRANT ALL ON TABLE "public"."meal_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."meal_plans" TO "service_role";



GRANT ALL ON TABLE "public"."meals" TO "anon";
GRANT ALL ON TABLE "public"."meals" TO "authenticated";
GRANT ALL ON TABLE "public"."meals" TO "service_role";



GRANT ALL ON TABLE "public"."measurements" TO "anon";
GRANT ALL ON TABLE "public"."measurements" TO "authenticated";
GRANT ALL ON TABLE "public"."measurements" TO "service_role";



GRANT ALL ON TABLE "public"."medical_conditions" TO "anon";
GRANT ALL ON TABLE "public"."medical_conditions" TO "authenticated";
GRANT ALL ON TABLE "public"."medical_conditions" TO "service_role";



GRANT ALL ON TABLE "public"."medications_catalog" TO "anon";
GRANT ALL ON TABLE "public"."medications_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."medications_catalog" TO "service_role";



GRANT ALL ON TABLE "public"."nutrition_types" TO "anon";
GRANT ALL ON TABLE "public"."nutrition_types" TO "authenticated";
GRANT ALL ON TABLE "public"."nutrition_types" TO "service_role";



GRANT ALL ON SEQUENCE "public"."nutrition_types_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."nutrition_types_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."nutrition_types_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
