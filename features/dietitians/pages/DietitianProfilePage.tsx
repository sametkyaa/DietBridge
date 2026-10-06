import React, { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentDietitianProfile, removeDietitianAvatar, uploadDietitianAvatar } from '../services/dietitianService';
import { DietitianProfile } from '../../../shared/types';
import { useAuth } from '../../auth/context/AuthContext';
import { useDietitianAvatarUrl } from '../../../shared/hooks/useDietitianAvatarUrl';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Icon,
  LoadingState,
  PageContainer,
  PageHeader,
  type IconName,
} from '../../../shared/ui';

const NOT_PROVIDED = 'Belirtilmemiş';

const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const hasNumber = (value: unknown): boolean => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

const ContactLine = ({ icon, label, value }: { icon: IconName; label: string; value: string | null }) => (
  <div className="flex items-center gap-2.5 text-13.5">
    <Icon name={icon} size={15} className="shrink-0 text-ink-3" />
    <span className="sr-only">{label}: </span>
    <span className={value ? 'min-w-0 break-words text-ink-2' : 'text-ink-3'}>{value ?? NOT_PROVIDED}</span>
  </div>
);

const DietitianProfilePage = () => {
  const [profile, setProfile] = useState<DietitianProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarAction, setAvatarAction] = useState<'upload' | 'remove' | null>(null);
  const [avatarMessage, setAvatarMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const { signOut, refreshAccess } = useAuth();
  const resolvedAvatarUrl = useDietitianAvatarUrl();

  useEffect(() => {
    const loadProfile = async () => {
      const data = await getCurrentDietitianProfile();
      setProfile(data);
      setLoading(false);
    };
    loadProfile();
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const handleAvatarFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || avatarAction) return;

    setAvatarAction('upload');
    setAvatarMessage(null);
    const result = await uploadDietitianAvatar(file);
    if (result.success && result.avatarPath) {
      setProfile((current) => (current ? { ...current, avatar_url: result.avatarPath ?? undefined } : current));
      setAvatarMessage({ type: 'success', text: 'Profil fotoğrafınız güncellendi.' });
      void refreshAccess();
    } else {
      setAvatarMessage({ type: 'error', text: result.error || 'Profil fotoğrafı güncellenemedi. Lütfen tekrar deneyin.' });
    }
    setAvatarAction(null);
  };

  const handleAvatarRemove = async () => {
    if (avatarAction) return;
    setAvatarAction('remove');
    setAvatarMessage(null);
    const result = await removeDietitianAvatar();
    if (result.success) {
      setProfile((current) => (current ? { ...current, avatar_url: undefined } : current));
      setAvatarMessage({ type: 'success', text: 'Profil fotoğrafınız kaldırıldı.' });
      void refreshAccess();
    } else {
      setAvatarMessage({ type: 'error', text: result.error || 'Profil fotoğrafı kaldırılamadı. Lütfen tekrar deneyin.' });
    }
    setAvatarAction(null);
    setConfirmRemoveOpen(false);
  };

  if (loading) {
    return <PageContainer><LoadingState label="Profil yükleniyor..." className="min-h-[60vh]" /></PageContainer>;
  }

  if (!profile) {
    return (
      <PageContainer>
        <EmptyState
          icon="user"
          title="Profil bulunamadı."
          description="Lütfen tekrar giriş yapmayı deneyin."
          action={<Button variant="secondary" leftIcon="sign-out" onClick={handleSignOut}>Çıkış Yap</Button>}
        />
      </PageContainer>
    );
  }

  const fullName = [profile.first_name, profile.last_name].filter(hasText).join(' ') || 'Diyetisyen';
  const specializations = hasText(profile.specialization)
    ? profile.specialization.split(',').map((spec) => spec.trim()).filter(Boolean)
    : [];

  return (
    <PageContainer>
      <PageHeader
        title="Profilim"
        description="Kişisel bilgilerinizi ve uzmanlık detaylarınızı görüntüleyin."
        actions={(
          <>
            <Button variant="secondary" leftIcon="pencil-simple" onClick={() => navigate('/profile/edit')}>Profili Düzenle</Button>
            <Button variant="danger" leftIcon="sign-out" onClick={handleSignOut}>Çıkış Yap</Button>
          </>
        )}
      />

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5">
          <Card padding="none" className="p-6 text-center">
            <Avatar name={fullName} src={resolvedAvatarUrl} size="xl" className="mx-auto" />
            <h2 className="m-0 mt-4 text-20 font-bold">{profile.first_name} {profile.last_name}</h2>
            {profile.verification_status === 'approved' && <Badge tone="ok" dot className="mt-2">Onaylı diyetisyen</Badge>}

            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={handleAvatarFileChange}
            />
            <div className="mt-5 flex flex-col gap-2">
              <Button
                variant="secondary"
                leftIcon="camera"
                fullWidth
                loading={avatarAction === 'upload'}
                disabled={avatarAction !== null}
                onClick={() => avatarInputRef.current?.click()}
              >
                {avatarAction === 'upload' ? 'Yükleniyor...' : profile.avatar_url ? 'Fotoğrafı Değiştir' : 'Fotoğraf Ekle'}
              </Button>
              {profile.avatar_url && (
                <Button variant="ghost" leftIcon="x" fullWidth disabled={avatarAction !== null} onClick={() => setConfirmRemoveOpen(true)}>
                  Fotoğrafı Kaldır
                </Button>
              )}
            </div>
            <p className="m-0 mt-2 text-12 text-ink-3">JPEG, PNG veya WEBP</p>
            {avatarMessage && (
              <Callout tone={avatarMessage.type === 'error' ? 'bad' : 'ok'} role={avatarMessage.type === 'error' ? 'alert' : 'status'} className="mt-3 text-left">
                {avatarMessage.text}
              </Callout>
            )}

            <div className="mt-5 flex flex-col gap-2 border-t border-line pt-5 text-left">
              <ContactLine icon="envelope" label="E-posta" value={hasText(profile.email) ? profile.email : null} />
              <ContactLine icon="phone" label="Telefon" value={hasText(profile.phone) ? profile.phone : null} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Deneyim" />
            <dl className="m-0 mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-db bg-canvas p-3.5">
                <dt className="text-12 font-semibold text-ink-3">Tecrübe</dt>
                <dd className="m-0 mt-1 text-22 font-bold tabular-nums">
                  {hasNumber(profile.experience_years) ? `${profile.experience_years} Yıl` : <span className="text-14 font-medium text-ink-3">{NOT_PROVIDED}</span>}
                </dd>
              </div>
              <div className="rounded-db bg-canvas p-3.5">
                <dt className="text-12 font-semibold text-ink-3">Mezuniyet</dt>
                <dd className="m-0 mt-1 text-22 font-bold tabular-nums">
                  {hasNumber(profile.graduation_year) ? profile.graduation_year : <span className="text-14 font-medium text-ink-3">{NOT_PROVIDED}</span>}
                </dd>
              </div>
            </dl>
          </Card>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card>
            <CardHeader title="Eğitim & Uzmanlık" />
            <dl className="m-0 mt-4 flex flex-col gap-5">
              <div>
                <dt className="text-12 font-semibold uppercase tracking-[0.06em] text-ink-3">Üniversite / Bölüm</dt>
                <dd className="m-0 mt-1 text-16 font-semibold">{hasText(profile.university) ? profile.university : <span className="font-medium text-ink-3">{NOT_PROVIDED}</span>}</dd>
              </div>
              <div>
                <dt className="text-12 font-semibold uppercase tracking-[0.06em] text-ink-3">Uzmanlık Alanı</dt>
                <dd className="m-0 mt-2 flex flex-wrap gap-2">
                  {specializations.length > 0
                    ? specializations.map((spec, index) => <Fragment key={`${spec}-${index}`}><Badge tone="neutral">{spec}</Badge></Fragment>)
                    : <span className="text-14 text-ink-3">{NOT_PROVIDED}</span>}
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Hakkında" />
            <p className="m-0 mt-4 whitespace-pre-line text-14.5 leading-7 text-ink-2">
              {hasText(profile.bio) ? profile.bio : 'Henüz bir biyografi eklenmemiş.'}
            </p>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRemoveOpen}
        title="Profil fotoğrafı kaldırılsın mı?"
        description="Profil fotoğrafınız kaldırılır; yerine baş harfleriniz gösterilir."
        confirmLabel="Fotoğrafı Kaldır"
        tone="danger"
        busy={avatarAction === 'remove'}
        onConfirm={() => void handleAvatarRemove()}
        onCancel={() => setConfirmRemoveOpen(false)}
      />
    </PageContainer>
  );
};

export default DietitianProfilePage;
