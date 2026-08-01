import { Client, Task, Appointment, Recipe } from './types';

// Avatars hotlinked from the original HTML provided
const AVATAR_AYSE = "https://lh3.googleusercontent.com/aida-public/AB6AXuDXIbFtvnP37vVB94Yt4Wa43jNFkJe6kw4o1PA0ne8m_NZm1qMGaiF3xCLK68K7SFPwWz362D5Q18vhlBjMjIGbRDmhi1E7E_k2wU7qO1TuywifN5Fj6Y8h2SPPupvRd4LWJ4k71jmgPAPoA-m1tOVpCB0UklohXMl0Ka6jadsrFPvJ3ncTirKTX2gV9EudZG01yOyuMWjjT7PeGH6dhB9oiZdSWmHIUCdwbeHT28vx4r_jlURdkCDlHIWMI_IvXZ4Wy5Jq0guTV1Q";
const AVATAR_MEHMET = "https://lh3.googleusercontent.com/aida-public/AB6AXuDtBnCpgJ0MVrNBTKRa1IORMcHHXS_SGVVvp8f0L7ykEnxs6DmOxXDTOwxjCh9ClQiBdZiucsvLagj5_C0u1Mp7gwyy8wAKxfrscOCIX-6zo4vyB2Nfb3ah_74Dbb27wCxb6nWMzb4GdwTAlNpJMqVakvLDxlz9dUsaytK4n09e8SC42vQAjDfAF49XedRecqVz28QaCO9WMF6ojPKYCj-miKBH6WmEFBktfjlXeSyX28IeoTTSHNW0zcd1XdpCYP-XZayykdSkG3Y";
const AVATAR_ZEYNEP = "https://lh3.googleusercontent.com/aida-public/AB6AXuDR2hrfs8TNhI2P1PsxH8N-eF-iZvuv0MeCelTzWj1JZ7jdRnXlKZe-PpzDr04In7UYrbR6q7sx5FXs8k8xEEGzcpbXd-YtsZp5Tire5N7jCHYuwaNxW7a22stcR9gRXGM-7Y8Pd4aegrlw4m2eQ2JMUT00nYMkioJrMxJv9RkZxgTwfif75XwZUBizQcG0U-dOaaypyaAGBZ-u9xWq5Z15CJjBIoypmkcFhbY2_eCotH8uxHAE_lENkbOCZqR_esKrc-O8HfwMaRE";
const AVATAR_FATMA = "https://lh3.googleusercontent.com/aida-public/AB6AXuAp_1sUgNnuN5gqUXA95-41dE8DWLcBZ9RKkBJowZIUMrKxEVZzVljEsS4SuuB2cR1H3Su6z9D9kE2FsH98UFonnvkTuFR_SPQ8AcepkashdCb4kU-U7117Xzg14v4jtB5EnISmhGRacBnAge8_uA8-LtaIrnEulkyouYX-J7jmqG_rt761NP5y9h8xlzPmYffQLPxtFvXO-aey9Gie-E0BGfr-gQ_aaw18P7Z36r7dfAYIeloWya1kQExOzlzp_K2-Y_OAzHPjbs4";
const AVATAR_ALI = "https://lh3.googleusercontent.com/aida-public/AB6AXuDhePm6GkYBUDE4bYMRNptSiGJnHTQJXikLhO9bdSAJVvVlDHJ8K96tq0notWFy7g2uBxngtCaiQugGHKdP71J2OwbUiG-wgIdJNcowEskntW3YNT_YR8RaJHXl52M9lgnad1UwLplO3dadHkTyWmj9uBDwbet-d_ieWF83EldM9BW7JYT6sP8rbeADMPbkDfZMyNuO2isQEckplsu0ehinXKOngUTiBjFeNSjEN268NqumizwQOqJCWezRZcffp3OSHdGXBAzwfa0";
export const USER_AVATAR = "https://lh3.googleusercontent.com/aida-public/AB6AXuDJuNjjfzaHq6NdFUv7jYsVuX3L7rLIckzyfPCcskncWkxLkGejTlQ8qRV2mjvZeyGVOB683LNQeqZgNpaMvluFxL9Lg9IRhnMN0ptlAoypCJBHtSefS-Gb5HT74rDgqWj4fIxHJ1SQY01CKvh5CN-p8yXUJxegnys2lE1VV4uj2fgGH58f0n8jvlJjLOXNlF7-ozGrpqQbQCTfuhmjkukqW_VOkrUc7PGOnvazLmGpnU4_YnH7_EIJVmJe0rhF4SdUm0aFMElUypE";
export const APP_LOGO = "/images/dietbridge-logo.svg";

export const CLIENTS: Client[] = [
  {
    id: '1',
    name: 'Esma Sayar',
    email: 'esma@example.com',
    avatar: AVATAR_AYSE,
    status: 'Aktif',
    goal: 'Kilo Verme',
    startDate: '15.03.2023',
    duration: '8 Ay',
    currentWeight: '65 kg',
    weeklyChange: -1.2,
    compliance: 92,
  },
  {
    id: '2',
    name: 'Mehmet Kaya',
    email: 'mehmet@example.com',
    avatar: AVATAR_MEHMET,
    status: 'Aktif',
    goal: 'Kas Kazanımı',
    startDate: '01.02.2023',
    duration: '9 Ay',
    currentWeight: '82 kg',
    weeklyChange: 0.8,
    compliance: 85,
  },
  {
    id: '3',
    name: 'Zeynep Aksoy',
    email: 'zeynep@example.com',
    avatar: AVATAR_ZEYNEP,
    status: 'Pasif',
    goal: 'Kilo Verme',
    startDate: '10.01.2023',
    duration: '10 Ay',
    currentWeight: '71 kg',
    weeklyChange: 0,
    compliance: 74,
  },
  {
    id: '4',
    name: 'Fatma Öztürk',
    email: 'fatma@example.com',
    avatar: AVATAR_FATMA,
    status: 'Aktif',
    goal: 'Kilo Verme',
    startDate: '22.04.2023',
    duration: '11 Ay',
    currentWeight: '58 kg',
    weeklyChange: -2.1,
    compliance: 95,
  },
  {
    id: '5',
    name: 'Ali Vural',
    email: 'ali@example.com',
    avatar: AVATAR_ALI,
    status: 'Aktif',
    goal: 'Sporcu Beslenmesi',
    startDate: '05.05.2023',
    duration: '12 Ay',
    currentWeight: '78 kg',
    weeklyChange: 0.3,
    compliance: 62,
  },
];

export const TASKS: Task[] = [
  {
    id: '1',
    title: 'Öğün fotoğrafını incele',
    clientName: 'Esma Sayar',
    clientAvatar: AVATAR_AYSE,
    timeInfo: '2 saat kaldı',
    isCompleted: false,
  },
  {
    id: '2',
    title: 'Planı güncelle',
    clientName: 'Mehmet Kaya',
    clientAvatar: AVATAR_MEHMET,
    timeInfo: 'Bugün',
    isCompleted: false,
  },
  {
    id: '3',
    title: 'Mesaja cevap ver',
    clientName: 'Zeynep Aksoy',
    clientAvatar: AVATAR_ZEYNEP,
    timeInfo: 'Dün',
    isCompleted: false,
  },
];

export const APPOINTMENTS: Appointment[] = [
  {
    id: '1',
    clientId: '4',
    time: '10:00',
    date: '2023-10-27',
    duration: '30dk',
    title: 'Haftalık Kontrol',
    clientName: 'Fatma Öztürk',
    clientAvatar: AVATAR_FATMA,
    type: 'Görüntülü Görüşme',
    status: 'upcoming',
  },
  {
    id: '2',
    clientId: '5',
    time: '14:30',
    date: '2023-10-27',
    duration: '45dk',
    title: 'Yeni Plan Değerlendirmesi',
    clientName: 'Ali Vural',
    clientAvatar: AVATAR_ALI,
    type: 'Yüzyüze',
    status: 'upcoming',
  },
  {
    id: '3',
    clientId: '6',
    time: '16:00',
    date: '2023-10-27',
    duration: '15dk',
    title: 'Hızlı Soru-Cevap',
    clientName: 'Emine Demir',
    type: 'Telefon Görüşmesi',
    status: 'upcoming',
  },
];

export const RECIPES: Recipe[] = [
  {
    id: '1',
    name: 'Avokadolu Poşe Yumurta',
    image: 'https://images.unsplash.com/photo-1525351484163-7529414395d8?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
    category: 'Kahvaltı',
    calories: 320,
    cuisine: 'Modern',
    createdAt: '10.08.2023',
    prepTime: '15 dk',
    servings: 1,
    ingredients: [
      '2 adet yumurta',
      '1 dilim tam buğday ekmeği',
      '1/2 olgun avokado',
      '1 tatlı kaşığı limon suyu',
      'Tuz, karabiber, pul biber',
      'Taze frenk soğanı (süslemek için)'
    ],
    instructions: [
      'Bir tencerede su kaynatın ve içine bir yemek kaşığı sirke ekleyin.',
      'Yumurtayı bir kaseye kırın ve kaynayan suya yavaşça bırakın. 3-4 dakika pişirin.',
      'Bu sırada ekmeği kızartın.',
      'Avokadoyu ezin, limon suyu, tuz ve karabiber ile karıştırın.',
      'Kızarmış ekmeğin üzerine avokado karışımını sürün.',
      'Pişen yumurtayı süzerek avokadonun üzerine yerleştirin.',
      'Pul biber ve frenk soğanı ile süsleyerek servis yapın.'
    ],
    macros: { protein: 14, carbs: 24, fat: 18 }
  },
  {
    id: '2',
    name: 'Izgara Tavuklu Kinoa Salatası',
    image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
    category: 'Öğle Yemeği',
    calories: 450,
    cuisine: 'Akdeniz',
    createdAt: '12.08.2023',
    prepTime: '25 dk',
    servings: 2,
    ingredients: [
      '200g tavuk göğsü',
      '1 su bardağı haşlanmış kinoa',
      '1 adet salatalık',
      '10 adet çeri domates',
      '1/4 demet maydanoz',
      'Zeytinyağı, limon suyu',
      'Tuz, kekik'
    ],
    instructions: [
      'Tavuk göğsünü tuz ve kekik ile marine edip ızgarada pişirin.',
      'Pişen tavuğu küp küp doğrayın.',
      'Salatalık ve domatesleri doğrayın, maydanozu ince kıyın.',
      'Geniş bir kasede kinoa, sebzeler ve tavukları karıştırın.',
      'Zeytinyağı ve limon suyu ekleyip karıştırarak servis yapın.'
    ],
    macros: { protein: 35, carbs: 40, fat: 12 }
  },
  {
    id: '3',
    name: 'Yulaflı Meyve Kasesi',
    image: 'https://images.unsplash.com/photo-1517673132405-a56a62b18caf?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
    category: 'Ara Öğün',
    calories: 180,
    cuisine: 'Vejetaryen',
    createdAt: '15.08.2023',
    prepTime: '5 dk',
    servings: 1,
    ingredients: [
      '4 yemek kaşığı yulaf ezmesi',
      '1 su bardağı badem sütü (veya normal süt)',
      '1/2 muz',
      '5-6 adet yaban mersini',
      '1 tatlı kaşığı chia tohumu',
      'Tarçın'
    ],
    instructions: [
      'Yulaf ve sütü bir kasede karıştırın (geceden bekletilebilir veya pişirilebilir).',
      'Üzerine dilimlenmiş muz ve yaban mersinlerini ekleyin.',
      'Chia tohumu ve tarçın serperek servis yapın.'
    ],
    macros: { protein: 6, carbs: 32, fat: 4 }
  },
  {
    id: '4',
    name: 'Fırında Somon ve Kuşkonmaz',
    image: 'https://images.unsplash.com/photo-1467003909585-2f8a7270028d?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
    category: 'Akşam Yemeği',
    calories: 520,
    cuisine: 'Deniz Ürünleri',
    createdAt: '18.08.2023',
    prepTime: '30 dk',
    servings: 2,
    ingredients: [
      '2 dilim somon fileto',
      '1 demet kuşkonmaz',
      '2 diş sarımsak',
      '3 yemek kaşığı zeytinyağı',
      '1/2 limon',
      'Tuz, karabiber, dereotu'
    ],
    instructions: [
      'Fırını 200 dereceye ısıtın.',
      'Somonları ve ayıklanmış kuşkonmazları yağlı kağıt serili tepsiye dizin.',
      'Üzerine zeytinyağı, ezilmiş sarımsak, tuz ve karabiber gezdirin.',
      'Somonların üzerine limon dilimleri yerleştirin.',
      'Yaklaşık 15-20 dakika pişirin. Dereotu ile süsleyip sıcak servis yapın.'
    ],
    macros: { protein: 42, carbs: 8, fat: 34 }
  },
  {
    id: '5',
    name: 'Şekersiz Muzlu Kek',
    image: 'https://images.unsplash.com/photo-1587015065420-59f2385960cc?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
    category: 'Tatlı',
    calories: 220,
    cuisine: 'Pastane',
    createdAt: '20.08.2023',
    prepTime: '45 dk',
    servings: 8,
    ingredients: [
      '3 adet olgun muz',
      '2 adet yumurta',
      '1 çay bardağı sıvı yağ',
      '2 su bardağı tam buğday unu',
      '1 paket kabartma tozu',
      '1 tatlı kaşığı tarçın',
      'İsteğe bağlı ceviz içi'
    ],
    instructions: [
      'Muzları çatalla ezin.',
      'Yumurta ve yağı ekleyip karıştırın.',
      'Un, kabartma tozu ve tarçını eleyerek ekleyin ve spatula ile karıştırın.',
      'Cevizleri ekleyin.',
      'Yağlanmış kek kalıbına dökün ve önceden ısıtılmış 170 derece fırında 35-40 dakika pişirin.'
    ],
    macros: { protein: 5, carbs: 30, fat: 10 }
  }
];
