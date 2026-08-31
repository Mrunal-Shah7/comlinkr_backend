import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const VIBES = [
  { slug: 'coffee_culture', name: 'Coffee Culture', description: 'Cafés & morning rituals', emoji: '☕' },
  { slug: 'art_museums', name: 'Art & Museums', description: 'Galleries & creative spaces', emoji: '🎨' },
  { slug: 'fitness_health', name: 'Fitness & Health', description: 'Gyms, yoga & active life', emoji: '💪' },
  { slug: 'nightlife', name: 'Nightlife', description: 'Bars, clubs & evening out', emoji: '🌙' },
  { slug: 'family_life', name: 'Family Life', description: 'Parks & kid-friendly spots', emoji: '👨‍👩‍👧' },
  { slug: 'wellness', name: 'Wellness', description: 'Mindfulness & self-care', emoji: '🧘' },
  { slug: 'foodie', name: 'Foodie', description: 'Restaurants & culinary adventures', emoji: '🍕' },
  { slug: 'outdoor', name: 'Outdoor', description: 'Hiking, parks & nature', emoji: '🏔️' },
  { slug: 'tech_innovation', name: 'Tech & Innovation', description: 'Meetups & startups', emoji: '💡' },
  { slug: 'music_events', name: 'Music & Events', description: 'Concerts & local artists', emoji: '🎵' },
  { slug: 'sports_games', name: 'Sports & Games', description: 'Teams & watch parties', emoji: '⚽' },
  { slug: 'volunteering', name: 'Volunteering', description: 'Community service', emoji: '🤝' },
];

const INTERESTS = [
  { slug: 'housing_real_estate', name: 'Housing & Real Estate', description: 'Find rentals, homes & roommates', icon: '🏠' },
  { slug: 'food_dining', name: 'Food & Dining', description: 'Discover local restaurants & eateries', icon: '🍽️' },
  { slug: 'community_social', name: 'Community & Social', description: 'Connect with locals & neighbors', icon: '👥' },
  { slug: 'events_entertainment', name: 'Events & Entertainment', description: "Never miss what's happening nearby", icon: '🎉' },
  { slug: 'jobs_careers', name: 'Jobs & Careers', description: 'Local opportunities & networking', icon: '💼' },
  { slug: 'health_wellness', name: 'Health & Wellness', description: 'Doctors, clinics & wellness services', icon: '🏥' },
  { slug: 'education_learning', name: 'Education & Learning', description: 'Schools, tutors & local courses', icon: '📚' },
  { slug: 'shopping_services', name: 'Shopping & Services', description: 'Local shops, deals & recommendations', icon: '🛍️' },
];

const COMMUNITIES: { slug: string; name: string; category: 'CULTURAL_HERITAGE' | 'NATIONAL_DIASPORA' | 'LIFESTYLE' | 'PROFESSIONAL' | 'SOCIAL_CAUSE' | 'FAITH_SPIRITUAL'; countryCode: string | null; emoji: string }[] = [
  // Cultural & Heritage
  { slug: 'south_asian_in', name: 'South Asian (IN)', category: 'CULTURAL_HERITAGE', countryCode: null, emoji: '🇮🇳' },
  { slug: 'east_asian', name: 'East Asian', category: 'CULTURAL_HERITAGE', countryCode: null, emoji: '🌏' },
  { slug: 'southeast_asian', name: 'Southeast Asian', category: 'CULTURAL_HERITAGE', countryCode: null, emoji: '🌏' },
  { slug: 'latin_american', name: 'Latin American', category: 'CULTURAL_HERITAGE', countryCode: null, emoji: '🌎' },
  { slug: 'african_afro_diaspora', name: 'African & Afro-Diaspora', category: 'CULTURAL_HERITAGE', countryCode: null, emoji: '🌍' },
  { slug: 'caribbean', name: 'Caribbean', category: 'CULTURAL_HERITAGE', countryCode: null, emoji: '🏝️' },
  { slug: 'middle_eastern', name: 'Middle Eastern', category: 'CULTURAL_HERITAGE', countryCode: null, emoji: '🕌' },
  { slug: 'european_eu', name: 'European (EU)', category: 'CULTURAL_HERITAGE', countryCode: null, emoji: '🇪🇺' },
  { slug: 'pacific_islander', name: 'Pacific Islander', category: 'CULTURAL_HERITAGE', countryCode: null, emoji: '🏝️' },
  { slug: 'indigenous_first_nations', name: 'Indigenous & First Nations', category: 'CULTURAL_HERITAGE', countryCode: null, emoji: '🪶' },
  { slug: 'south_american', name: 'South American', category: 'CULTURAL_HERITAGE', countryCode: null, emoji: '🌎' },
  { slug: 'central_asian', name: 'Central Asian', category: 'CULTURAL_HERITAGE', countryCode: null, emoji: '🌏' },
  // National & Diaspora
  { slug: 'mexican_mx', name: 'Mexican (MX)', category: 'NATIONAL_DIASPORA', countryCode: 'MX', emoji: '🇲🇽' },
  { slug: 'brazilian_br', name: 'Brazilian (BR)', category: 'NATIONAL_DIASPORA', countryCode: 'BR', emoji: '🇧🇷' },
  { slug: 'colombian_co', name: 'Colombian (CO)', category: 'NATIONAL_DIASPORA', countryCode: 'CO', emoji: '🇨🇴' },
  { slug: 'cuban_cu', name: 'Cuban (CU)', category: 'NATIONAL_DIASPORA', countryCode: 'CU', emoji: '🇨🇺' },
  { slug: 'dominican_do', name: 'Dominican (DO)', category: 'NATIONAL_DIASPORA', countryCode: 'DO', emoji: '🇩🇴' },
  { slug: 'puerto_rican_pr', name: 'Puerto Rican (PR)', category: 'NATIONAL_DIASPORA', countryCode: 'PR', emoji: '🇵🇷' },
  { slug: 'venezuelan_ve', name: 'Venezuelan (VE)', category: 'NATIONAL_DIASPORA', countryCode: 'VE', emoji: '🇻🇪' },
  { slug: 'peruvian_pe', name: 'Peruvian (PE)', category: 'NATIONAL_DIASPORA', countryCode: 'PE', emoji: '🇵🇪' },
  { slug: 'indian_in', name: 'Indian (IN)', category: 'NATIONAL_DIASPORA', countryCode: 'IN', emoji: '🇮🇳' },
  { slug: 'pakistani_pk', name: 'Pakistani (PK)', category: 'NATIONAL_DIASPORA', countryCode: 'PK', emoji: '🇵🇰' },
  { slug: 'bangladeshi_bd', name: 'Bangladeshi (BD)', category: 'NATIONAL_DIASPORA', countryCode: 'BD', emoji: '🇧🇩' },
  { slug: 'sri_lankan_lk', name: 'Sri Lankan (LK)', category: 'NATIONAL_DIASPORA', countryCode: 'LK', emoji: '🇱🇰' },
  { slug: 'nepali_np', name: 'Nepali (NP)', category: 'NATIONAL_DIASPORA', countryCode: 'NP', emoji: '🇳🇵' },
  { slug: 'chinese_cn', name: 'Chinese (CN)', category: 'NATIONAL_DIASPORA', countryCode: 'CN', emoji: '🇨🇳' },
  { slug: 'korean_kr', name: 'Korean (KR)', category: 'NATIONAL_DIASPORA', countryCode: 'KR', emoji: '🇰🇷' },
  { slug: 'japanese_jp', name: 'Japanese (JP)', category: 'NATIONAL_DIASPORA', countryCode: 'JP', emoji: '🇯🇵' },
  { slug: 'filipino_ph', name: 'Filipino (PH)', category: 'NATIONAL_DIASPORA', countryCode: 'PH', emoji: '🇵🇭' },
  { slug: 'vietnamese_vn', name: 'Vietnamese (VN)', category: 'NATIONAL_DIASPORA', countryCode: 'VN', emoji: '🇻🇳' },
  { slug: 'thai_th', name: 'Thai (TH)', category: 'NATIONAL_DIASPORA', countryCode: 'TH', emoji: '🇹🇭' },
  { slug: 'indonesian_id', name: 'Indonesian (ID)', category: 'NATIONAL_DIASPORA', countryCode: 'ID', emoji: '🇮🇩' },
  { slug: 'british_gb', name: 'British (GB)', category: 'NATIONAL_DIASPORA', countryCode: 'GB', emoji: '🇬🇧' },
  { slug: 'italian_it', name: 'Italian (IT)', category: 'NATIONAL_DIASPORA', countryCode: 'IT', emoji: '🇮🇹' },
  { slug: 'irish_ie', name: 'Irish (IE)', category: 'NATIONAL_DIASPORA', countryCode: 'IE', emoji: '🇮🇪' },
  { slug: 'spanish_es', name: 'Spanish (ES)', category: 'NATIONAL_DIASPORA', countryCode: 'ES', emoji: '🇪🇸' },
  { slug: 'french_fr', name: 'French (FR)', category: 'NATIONAL_DIASPORA', countryCode: 'FR', emoji: '🇫🇷' },
  { slug: 'greek_gr', name: 'Greek (GR)', category: 'NATIONAL_DIASPORA', countryCode: 'GR', emoji: '🇬🇷' },
  { slug: 'portuguese_pt', name: 'Portuguese (PT)', category: 'NATIONAL_DIASPORA', countryCode: 'PT', emoji: '🇵🇹' },
  { slug: 'polish_pl', name: 'Polish (PL)', category: 'NATIONAL_DIASPORA', countryCode: 'PL', emoji: '🇵🇱' },
  { slug: 'ukrainian_ua', name: 'Ukrainian (UA)', category: 'NATIONAL_DIASPORA', countryCode: 'UA', emoji: '🇺🇦' },
  { slug: 'russian_ru', name: 'Russian (RU)', category: 'NATIONAL_DIASPORA', countryCode: 'RU', emoji: '🇷🇺' },
  { slug: 'german_de', name: 'German (DE)', category: 'NATIONAL_DIASPORA', countryCode: 'DE', emoji: '🇩🇪' },
  { slug: 'romanian_ro', name: 'Romanian (RO)', category: 'NATIONAL_DIASPORA', countryCode: 'RO', emoji: '🇷🇴' },
  { slug: 'nigerian_ng', name: 'Nigerian (NG)', category: 'NATIONAL_DIASPORA', countryCode: 'NG', emoji: '🇳🇬' },
  { slug: 'ghanaian_gh', name: 'Ghanaian (GH)', category: 'NATIONAL_DIASPORA', countryCode: 'GH', emoji: '🇬🇭' },
  { slug: 'kenyan_ke', name: 'Kenyan (KE)', category: 'NATIONAL_DIASPORA', countryCode: 'KE', emoji: '🇰🇪' },
  { slug: 'ethiopian_et', name: 'Ethiopian (ET)', category: 'NATIONAL_DIASPORA', countryCode: 'ET', emoji: '🇪🇹' },
  { slug: 'somali_so', name: 'Somali (SO)', category: 'NATIONAL_DIASPORA', countryCode: 'SO', emoji: '🇸🇴' },
  { slug: 'zimbabwean_zw', name: 'Zimbabwean (ZW)', category: 'NATIONAL_DIASPORA', countryCode: 'ZW', emoji: '🇿🇼' },
  { slug: 'south_african_za', name: 'South African (ZA)', category: 'NATIONAL_DIASPORA', countryCode: 'ZA', emoji: '🇿🇦' },
  { slug: 'jamaican_jm', name: 'Jamaican (JM)', category: 'NATIONAL_DIASPORA', countryCode: 'JM', emoji: '🇯🇲' },
  { slug: 'trinidadian_tt', name: 'Trinidadian (TT)', category: 'NATIONAL_DIASPORA', countryCode: 'TT', emoji: '🇹🇹' },
  { slug: 'haitian_ht', name: 'Haitian (HT)', category: 'NATIONAL_DIASPORA', countryCode: 'HT', emoji: '🇭🇹' },
  { slug: 'egyptian_eg', name: 'Egyptian (EG)', category: 'NATIONAL_DIASPORA', countryCode: 'EG', emoji: '🇪🇬' },
  { slug: 'moroccan_ma', name: 'Moroccan (MA)', category: 'NATIONAL_DIASPORA', countryCode: 'MA', emoji: '🇲🇦' },
  { slug: 'lebanese_lb', name: 'Lebanese (LB)', category: 'NATIONAL_DIASPORA', countryCode: 'LB', emoji: '🇱🇧' },
  { slug: 'iranian_persian_ir', name: 'Iranian / Persian (IR)', category: 'NATIONAL_DIASPORA', countryCode: 'IR', emoji: '🇮🇷' },
  { slug: 'turkish_tr', name: 'Turkish (TR)', category: 'NATIONAL_DIASPORA', countryCode: 'TR', emoji: '🇹🇷' },
  { slug: 'afghan_af', name: 'Afghan (AF)', category: 'NATIONAL_DIASPORA', countryCode: 'AF', emoji: '🇦🇫' },
  { slug: 'syrian_sy', name: 'Syrian (SY)', category: 'NATIONAL_DIASPORA', countryCode: 'SY', emoji: '🇸🇾' },
  { slug: 'arab', name: 'Arab', category: 'NATIONAL_DIASPORA', countryCode: null, emoji: '🌍' },
  // Lifestyle
  { slug: 'expat', name: 'Expat', category: 'LIFESTYLE', countryCode: null, emoji: '✈️' },
  { slug: 'digital_nomad', name: 'Digital Nomad', category: 'LIFESTYLE', countryCode: null, emoji: '💻' },
  { slug: 'student', name: 'Student', category: 'LIFESTYLE', countryCode: null, emoji: '🎓' },
  { slug: 'young_professional', name: 'Young Professional', category: 'LIFESTYLE', countryCode: null, emoji: '💼' },
  { slug: 'new_in_town', name: 'New in Town', category: 'LIFESTYLE', countryCode: null, emoji: '🆕' },
  { slug: 'retiree_seniors', name: 'Retiree & Seniors', category: 'LIFESTYLE', countryCode: null, emoji: '👴' },
  { slug: 'parents_families', name: 'Parents & Families', category: 'LIFESTYLE', countryCode: null, emoji: '👨‍👩‍👧‍👦' },
  { slug: 'pet_owners', name: 'Pet Owners', category: 'LIFESTYLE', countryCode: null, emoji: '🐾' },
  // Professional
  { slug: 'tech_startups', name: 'Tech & Startups', category: 'PROFESSIONAL', countryCode: null, emoji: '🚀' },
  { slug: 'creatives_artists', name: 'Creatives & Artists', category: 'PROFESSIONAL', countryCode: null, emoji: '🎨' },
  { slug: 'healthcare_workers', name: 'Healthcare Workers', category: 'PROFESSIONAL', countryCode: null, emoji: '🏥' },
  { slug: 'educators_teachers', name: 'Educators & Teachers', category: 'PROFESSIONAL', countryCode: null, emoji: '📚' },
  { slug: 'entrepreneurs', name: 'Entrepreneurs', category: 'PROFESSIONAL', countryCode: null, emoji: '💡' },
  { slug: 'finance_business', name: 'Finance & Business', category: 'PROFESSIONAL', countryCode: null, emoji: '📈' },
  { slug: 'legal_government', name: 'Legal & Government', category: 'PROFESSIONAL', countryCode: null, emoji: '⚖️' },
  // Social & Cause
  { slug: 'lgbtq', name: 'LGBTQ+', category: 'SOCIAL_CAUSE', countryCode: null, emoji: '🏳️‍🌈' },
  { slug: 'womens_network', name: "Women's Network", category: 'SOCIAL_CAUSE', countryCode: null, emoji: '👩' },
  { slug: 'veterans', name: 'Veterans', category: 'SOCIAL_CAUSE', countryCode: null, emoji: '🎖️' },
  { slug: 'eco_conscious', name: 'Eco-Conscious', category: 'SOCIAL_CAUSE', countryCode: null, emoji: '🌱' },
  { slug: 'volunteer_network', name: 'Volunteer Network', category: 'SOCIAL_CAUSE', countryCode: null, emoji: '🤝' },
  { slug: 'disability_community', name: 'Disability Community', category: 'SOCIAL_CAUSE', countryCode: null, emoji: '♿' },
  { slug: 'mental_health_advocates', name: 'Mental Health Advocates', category: 'SOCIAL_CAUSE', countryCode: null, emoji: '💚' },
  // Faith & Spiritual
  { slug: 'christian', name: 'Christian', category: 'FAITH_SPIRITUAL', countryCode: null, emoji: '✝️' },
  { slug: 'muslim', name: 'Muslim', category: 'FAITH_SPIRITUAL', countryCode: null, emoji: '🕌' },
  { slug: 'jewish', name: 'Jewish', category: 'FAITH_SPIRITUAL', countryCode: null, emoji: '✡️' },
  { slug: 'hindu', name: 'Hindu', category: 'FAITH_SPIRITUAL', countryCode: null, emoji: '🕉️' },
  { slug: 'buddhist', name: 'Buddhist', category: 'FAITH_SPIRITUAL', countryCode: null, emoji: '☸️' },
  { slug: 'interfaith_spiritual', name: 'Interfaith & Spiritual', category: 'FAITH_SPIRITUAL', countryCode: null, emoji: '🙏' },
];

async function main() {
  let vibeCount = 0;
  for (const v of VIBES) {
    await prisma.vibe.upsert({
      where: { slug: v.slug },
      create: v,
      update: v,
    });
    vibeCount++;
  }
  console.log(`Seeded ${vibeCount} vibes`);

  let interestCount = 0;
  for (const i of INTERESTS) {
    await prisma.interest.upsert({
      where: { slug: i.slug },
      create: i,
      update: i,
    });
    interestCount++;
  }
  console.log(`Seeded ${interestCount} interests`);

  let communityCount = 0;
  for (const c of COMMUNITIES) {
    await prisma.community.upsert({
      where: { slug: c.slug },
      create: {
        slug: c.slug,
        name: c.name,
        category: c.category,
        countryCode: c.countryCode,
        emoji: c.emoji,
      },
      update: {
        name: c.name,
        category: c.category,
        countryCode: c.countryCode,
        emoji: c.emoji,
      },
    });
    communityCount++;
  }
  console.log(`Seeded ${communityCount} communities`);

  async function seedAdminUser(
    email: string,
    username: string,
    fullName: string,
    password: string,
  ) {
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        username,
        fullName,
        role: 'ADMIN',
        onboardingCompleted: true,
        authProviders: {
          create: {
            provider: 'LOCAL',
            passwordHash,
          },
        },
      },
      update: {
        fullName,
        role: 'ADMIN',
        onboardingCompleted: true,
      },
      include: { authProviders: true },
    });

    if (user.authProviders.length === 0) {
      await prisma.authProvider.upsert({
        where: {
          userId_provider: { userId: user.id, provider: 'LOCAL' },
        },
        create: {
          userId: user.id,
          provider: 'LOCAL',
          passwordHash,
        },
        update: { passwordHash },
      });
    } else {
      await prisma.authProvider.updateMany({
        where: { userId: user.id, provider: 'LOCAL' },
        data: { passwordHash },
      });
    }

    console.log(`Seeded admin user (${email})`);
  }

  await seedAdminUser(
    'shahmrunal777@gmail.com',
    'shahmrunal777',
    'Shahm Runal',
    'pmscrm007',
  );

  await seedAdminUser(
    'Pavanbarot0610@gmail.com',
    'pavanbarot0610',
    'Pavan Barot',
    'Pavan@610',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
