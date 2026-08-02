-- Staging baseline restore güvenlik prelude'u.
-- Yeni oluşturulacak public tabloların hedef projenin geniş varsayılan
-- tablo yetkilerini otomatik olarak miras almasını engeller.

alter default privileges in schema public
revoke all on tables from anon, authenticated
