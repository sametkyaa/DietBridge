// Dev-only fixture: Faz 1 tasarım sistemi bileşen galerisi. Vite build girdisi veya uygulama rotası değildir.
// Açmak için: npm run dev, ardından /tests/browser/design-system-gallery.html (?modal=1 pencereyi açık başlatır).
import { useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Checkbox,
  Chip,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ICON_NAMES,
  Icon,
  IconButton,
  Input,
  KpiGrid,
  KpiTile,
  LoadingState,
  Modal,
  PageContainer,
  PageHeader,
  Pagination,
  PersonCell,
  PillGroup,
  ProgressBar,
  RadioCards,
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  TBody,
  THead,
  Table,
  TableCard,
  TableFooter,
  TabPanel,
  Tabs,
  Tag,
  Td,
  Textarea,
  Th,
  Toggle,
  Tr,
} from '../../shared/ui';
import '../../styles.css';

const swatches = [
  'canvas', 'surface', 'surface-alt', 'sunk', 'line', 'line-strong', 'ink', 'ink-2', 'ink-3', 'brand', 'brand-hi', 'brand-tint',
  'brand-soft', 'brand-lime', 'ok', 'ok-bg', 'warn', 'warn-bg', 'bad', 'bad-bg', 'info', 'info-bg', 'vio', 'vio-bg', 'water',
];

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <Card className="mb-5">
    <CardHeader title={title} />
    {children}
  </Card>
);

const rows = [
  { name: 'Örnek Danışan A', mail: 'a@ornek.invalid', status: 'Aktif', tone: 'ok' as const, weight: '68,4 kg', adherence: 86 },
  { name: 'Örnek Danışan B', mail: 'b@ornek.invalid', status: 'Aktif', tone: 'ok' as const, weight: '91,2 kg', adherence: 58 },
  { name: 'Örnek Danışan C', mail: 'c@ornek.invalid', status: 'Dikkat', tone: 'warn' as const, weight: '102,5 kg', adherence: 22 },
];

function Gallery() {
  const params = new URLSearchParams(location.search);
  const [modalOpen, setModalOpen] = useState(params.get('modal') === '1');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState<'late' | 'today' | 'soon' | 'done'>('late');
  const [seg, setSeg] = useState<'all' | 'attention'>('all');
  const [pill, setPill] = useState('all');
  const [page, setPage] = useState(1);
  const [toggle, setToggle] = useState(true);
  const [type, setType] = useState<'video' | 'office' | 'phone'>('video');
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Faz 1 · ortak bileşenler"
        title="Tasarım sistemi"
        description="shared/ui içindeki bileşenler, prototipteki ölçülerle."
        actions={
          <>
            <SearchInput label="Bileşen ara" placeholder="Danışan ara…" />
            <IconButton icon="bell" label="Bildirimler" dot />
            <Button variant="primary" leftIcon="plus" onClick={() => setModalOpen(true)}>
              Yeni randevu
            </Button>
          </>
        }
      />

      <KpiGrid>
        <KpiTile icon="users-three-duotone" label="Aktif danışan" value="24" trend={{ text: '+2', tone: 'ok' }} hint="bu ay" />
        <KpiTile icon="calendar-check-duotone" label="Bu hafta randevu" value="11" hint="Bugün 4 · kalan 7" />
        <KpiTile icon="bowl-food-duotone" label="Ortalama öğün uyumu" value="%78" trend={{ text: '▲ 3 puan', tone: 'ok' }} hint="geçen haftaya göre" />
        <KpiTile icon="chat-circle-dots-duotone" label="Okunmamış mesaj" value="3" loading={params.get('loading') === '1'} hint="2 danışandan" />
      </KpiGrid>

      <div className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)' }}>
        <div>
          <Section title="Butonlar">
            <div className="flex flex-wrap items-center gap-2.5">
              <Button variant="primary" leftIcon="plus">Birincil</Button>
              <Button leftIcon="download-simple">İkincil</Button>
              <Button variant="ghost">Hayalet</Button>
              <Button variant="danger">Tehlikeli</Button>
              <Button variant="lime">Lime</Button>
              <Button variant="primary" loading>Kaydediliyor</Button>
              <Button size="sm" leftIcon="plus">Küçük</Button>
              <Button disabled>Devre dışı</Button>
              <IconButton icon="dots-three" label="Diğer işlemler" />
              <IconButton icon="x" label="Kapat" variant="bare" size="sm" />
            </div>
          </Section>

          <Card padding="none" className="mb-5">
            <CardHeader title="Sekmeler" padded actions={<Button size="sm" leftIcon="plus">Görev ekle</Button>} className="mb-0" />
            <Tabs
              idBase="gorev"
              ariaLabel="Görev filtresi"
              value={tab}
              onChange={setTab}
              className="mt-2.5 px-[22px]"
              items={[
                { value: 'late', label: 'Geciken', count: 4, countTone: 'bad' },
                { value: 'today', label: 'Bugün', count: 3 },
                { value: 'soon', label: 'Yaklaşan', count: 5 },
                { value: 'done', label: 'Tamamlanan' },
              ]}
            />
            {(['late', 'today', 'soon', 'done'] as const).map((value) => (
              <TabPanel key={value} idBase="gorev" value={value} activeValue={tab} className="px-[22px] py-4 text-13.5 text-ink-2">
                <span className="font-semibold text-ink">Örnek görev</span> için haftalık planı güncelle<Tag>Otomatik</Tag>
              </TabPanel>
            ))}
            <div className="flex flex-wrap gap-3 border-t border-line px-[22px] py-4">
              <SegmentedControl
                ariaLabel="Danışan filtresi"
                value={seg}
                onChange={setSeg}
                options={[{ value: 'all', label: 'Tümü', count: 27 }, { value: 'attention', label: 'Dikkat', count: 3 }]}
              />
              <PillGroup
                ariaLabel="Tarif kategorisi"
                value={pill}
                onChange={setPill}
                options={[{ value: 'all', label: 'Tümü' }, { value: 'breakfast', label: 'Kahvaltı' }, { value: 'snack', label: 'Ara öğün' }]}
              />
            </div>
          </Card>

          <TableCard className="mb-5">
            <Table caption="Danışan listesi örneği">
              <THead>
                <tr>
                  <Th>Danışan</Th>
                  <Th>Durum</Th>
                  <Th align="right">Güncel kilo</Th>
                  <Th>Öğün uyumu (7 gün)</Th>
                  <Th align="right"><span className="sr-only">İşlemler</span></Th>
                </tr>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <Tr key={row.name}>
                    <Td><PersonCell name={row.name} subtitle={row.mail} /></Td>
                    <Td><Badge tone={row.tone} size="sm" dot>{row.status}</Badge></Td>
                    <Td align="right" numeric className="font-semibold">{row.weight}</Td>
                    <Td>
                      <div className="flex items-center gap-3" style={{ width: 176 }}>
                        <ProgressBar value={row.adherence} tone={row.adherence < 30 ? 'bad' : row.adherence < 60 ? 'warn' : 'brand'} label="Öğün uyumu" valueText={`%${row.adherence}`} />
                        <span className="w-9 text-right font-semibold tabular-nums">%{row.adherence}</span>
                      </div>
                    </Td>
                    <Td align="right"><IconButton icon="dots-three" label={`${row.name} için işlemler`} /></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <TableFooter summary="27 danışandan 1–8 gösteriliyor">
              <Pagination page={page} pageCount={3} onPageChange={setPage} />
            </TableFooter>
          </TableCard>

          <Section title="Form alanları">
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <Input label="E-posta" type="email" leadingIcon="envelope" placeholder="ad@ornek.com" hint="Danışanın kayıtlı e-postası" />
              <Input label="Kilo" inputMode="decimal" defaultValue="68,4" trailing={<span className="text-13 text-ink-3">kg</span>} />
              <Select label="Süre" defaultValue="45" options={[{ value: '30', label: '30 dk' }, { value: '45', label: '45 dk' }, { value: '60', label: '60 dk' }]} />
              <Input label="Başlık" required error="Başlık boş bırakılamaz." placeholder="Kontrol görüşmesi" />
              <div style={{ gridColumn: '1 / -1' }}>
                <Textarea label="Not" placeholder="Görüşme notu…" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <RadioCards
                  legend="Görüşme türü"
                  name="gorusme-turu"
                  value={type}
                  onChange={setType}
                  options={[
                    { value: 'video', label: 'Görüntülü', icon: 'video-camera' },
                    { value: 'office', label: 'Yüz yüze', icon: 'buildings' },
                    { value: 'phone', label: 'Telefon', icon: 'phone' },
                  ]}
                />
              </div>
              <Checkbox label="Beni hatırla" defaultChecked />
              <Toggle label="Yeni bağlantılara açık" description="Davet kodu ile bağlanma" checked={toggle} onChange={setToggle} />
            </div>
          </Section>
        </div>

        <div>
          <Section title="Rozetler ve avatarlar">
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge tone="ok" dot>Aktif</Badge>
              <Badge tone="warn" dot>Dikkat</Badge>
              <Badge tone="bad">1 gün gecikti</Badge>
              <Badge tone="info">Görüntülü</Badge>
              <Badge tone="brand">Kilo vermek</Badge>
              <Badge>5 öğün</Badge>
              <Chip>Brokoli</Chip>
            </div>
            <div className="flex items-center gap-3">
              <Avatar name="Örnek Danışan" size="xl" />
              <Avatar name="Ayşe Kaya" size="lg" />
              <Avatar name="Can Öztürk" />
              <Avatar name="İpek Şen" size="sm" />
              <Avatar name="Zehra" size="xs" />
            </div>
          </Section>

          <Section title="Uyarı kutuları">
            <div className="flex flex-col gap-2.5">
              <Callout tone="info">Bu hafta 1 randevu daha var.</Callout>
              <Callout tone="warn">2 kaydedilmemiş değişiklik</Callout>
              <Callout tone="mute">Sağlık bilgisini danışan mobilde girer.</Callout>
            </div>
          </Section>

          <Card padding="none" className="mb-5">
            <CardHeader title="Durumlar" padded link={{ to: '#', label: 'Tümü' }} />
            <LoadingState variant="skeleton" rows={2} />
            <div className="border-t border-line">
              <EmptyState compact icon="calendar-blank" title="Bugün randevu yok" description="Yeni randevu oluşturduğunuzda burada görünür." action={<Button size="sm" leftIcon="plus">Randevu ekle</Button>} />
            </div>
            <div className="border-t border-line">
              <ErrorState compact onRetry={() => setConfirmOpen(true)} />
            </div>
            <div className="flex items-center gap-3 border-t border-line px-[22px] py-4">
              <Skeleton circle className="h-9 w-9" />
              <Skeleton className="h-3.5 w-40" />
            </div>
          </Card>

          <Section title={`İkonlar (${ICON_NAMES.length})`}>
            <ul className="m-0 grid list-none gap-1 p-0" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
              {ICON_NAMES.map((name) => (
                <li key={name} className="flex flex-col items-center gap-1 rounded-control px-1 py-2 text-center text-10 text-ink-3" title={name}>
                  <Icon name={name} size={20} className={name.endsWith('-duotone') ? 'text-brand' : 'text-ink-2'} />
                  <span className="w-full truncate">{name}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Renk belirteçleri">
            <ul className="m-0 grid list-none gap-2 p-0" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
              {swatches.map((name) => (
                <li key={name} className="text-10 text-ink-2">
                  <span className="mb-1 block h-8 rounded-tag border border-line" style={{ background: `rgb(var(--db-${name}))` }} />
                  {name}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Yeni randevu"
        initialFocusRef={firstFieldRef}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Vazgeç</Button>
            <Button variant="primary" onClick={() => setModalOpen(false)}>Randevu oluştur</Button>
          </>
        }
      >
        <Select ref={firstFieldRef} label="Danışan" placeholder="Danışan seçin" defaultValue="" options={[{ value: 'a', label: 'Örnek Danışan A' }]} />
        <RadioCards
          legend="Görüşme türü"
          name="modal-gorusme-turu"
          value={type}
          onChange={setType}
          options={[
            { value: 'video', label: 'Görüntülü', icon: 'video-camera' },
            { value: 'office', label: 'Yüz yüze', icon: 'buildings' },
            { value: 'phone', label: 'Telefon', icon: 'phone' },
          ]}
        />
        <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr 0.8fr' }}>
          <Input label="Tarih" leadingIcon="calendar-blank" type="text" defaultValue="9 Ekim 2026" />
          <Input label="Saat" leadingIcon="clock" type="text" defaultValue="15:00" />
          <Select label="Süre" defaultValue="45" options={[{ value: '30', label: '30 dk' }, { value: '45', label: '45 dk' }]} />
        </div>
        <Input label="Başlık" defaultValue="Kontrol görüşmesi" />
        <Callout tone="info">Bu danışanla bu hafta 1 randevunuz daha var.</Callout>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title="Not silinsin mi?"
        description="Bu işlem geri alınamaz."
        confirmLabel="Sil"
        tone="danger"
        onConfirm={() => setConfirmOpen(false)}
        onCancel={() => setConfirmOpen(false)}
      />
    </PageContainer>
  );
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Gallery />
  </BrowserRouter>,
);
