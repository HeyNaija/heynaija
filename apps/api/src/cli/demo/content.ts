// What the demo seed writes: members, and conversations as trees. Everything is
// fiction. Times are relative to when the seed runs, so the feed always looks
// like the last few days.
import { type Art, ankara, avatar, bookshelf, code, pitch, plate, skyline, studio } from './art.js'

export type DemoMember = { handle: string; name: string; bio: string; avatar?: Art; joinedDaysAgo: number }

export type DemoImage = { art: Art | 'brand-photo'; alt: string }

export type DemoReply = {
  by: string
  text?: string
  images?: DemoImage[]
  /** Minutes after the post it answers; by default replies arrive a few minutes apart. */
  after?: number
  /** Deleted by its author later, so it shows as unavailable while its replies remain. */
  deleted?: boolean
  replies?: DemoReply[]
}

export type DemoThread = DemoReply & { hoursAgo: number; community?: string }

/** Replies to posts that already exist in the database, matched by author and opening words. */
export type DemoAnswer = { to: { handle: string; startsWith: string }; replies: DemoReply[] }

export const MEMBERS: DemoMember[] = [
  { handle: 'amaka_writes', name: 'Amaka Obi', bio: 'Writer. Lagos by way of Enugu. Chronic jollof critic.', joinedDaysAgo: 40, avatar: avatar(11, ['#f3d9c4', '#d9531e', '#2f6b3c']) },
  { handle: 'tunde_builds', name: 'Tunde Bakare', bio: 'Backend engineer. Shipping boring software from Yaba.', joinedDaysAgo: 38, avatar: avatar(12, ['#dbe7f5', '#1f4e79', '#e0af68']) },
  { handle: 'zainab_abj', name: 'Zainab Musa', bio: 'Architect in Abuja. Plants, buildings, quiet weekends.', joinedDaysAgo: 35, avatar: avatar(13, ['#e6efe0', '#3f7d2f', '#c4572e']) },
  { handle: 'kelechi_fc', name: 'Kelechi Eze', bio: 'Super Eagles optimist. Professional sufferer.', joinedDaysAgo: 33, avatar: avatar(14, ['#e2f2e6', '#238a42', '#f2c230']) },
  { handle: 'funke_eats', name: 'Funke Adeyemi', bio: 'I review buka food so you do not have to.', joinedDaysAgo: 31, avatar: avatar(15, ['#fde8cf', '#e9a23b', '#8a3b12']) },
  { handle: 'ibrahim_dev', name: 'Ibrahim Sani', bio: 'Mobile developer. Kano and Lagos. Coffee over tea.', joinedDaysAgo: 29, avatar: avatar(16, ['#e4e1f5', '#5b3a6e', '#7dcfff']) },
  { handle: 'ngozi_unilag', name: 'Ngozi Okeke', bio: 'Final year Mass Comm student. Surviving.', joinedDaysAgo: 27 },
  { handle: 'segun_beats', name: 'Segun Alabi', bio: 'Producer. Afrobeats, amapiano and whatever my cousin plays on guitar.', joinedDaysAgo: 25, avatar: avatar(18, ['#1a1d2b', '#3ddc97', '#ff7a45']) },
  { handle: 'chioma_law', name: 'Chioma Nnadi', bio: 'Lawyer. Reads tenancy agreements for fun.', joinedDaysAgo: 23, avatar: avatar(19, ['#f5e6e8', '#a23b2a', '#14213d']) },
  { handle: 'musa_lens', name: 'Musa Danladi', bio: 'Street photographer. Jos, Abuja, wherever the light is.', joinedDaysAgo: 21, avatar: avatar(20, ['#fbe3c8', '#f08a24', '#2a2f45']) },
  { handle: 'bisi_mum', name: 'Bisi Ogunleye', bio: 'Mum of two. Fabric shop in Ibadan.', joinedDaysAgo: 19 },
  { handle: 'emeka_ng', name: 'Emeka Nwankwo', bio: 'Product manager. Ask me about payments.', joinedDaysAgo: 17, avatar: avatar(22, ['#e0f0f2', '#3b7c8c', '#d9a440']) },
  { handle: 'halima_reads', name: 'Halima Yusuf', bio: 'Book club host. Reading African authors all year.', joinedDaysAgo: 15, avatar: avatar(23, ['#f1e9f7', '#5b3a6e', '#d9a440']) },
  { handle: 'dayo_runs', name: 'Dayo Akande', bio: 'Running Lagos one bridge at a time.', joinedDaysAgo: 12 },
]

// The real members already in a dev database whom some demo members follow.
export const FOLLOWED_REAL_MEMBERS = ['psami', 'chidi', 'ada', 'bayo']

const lagosDusk = { sky: ['#2b1d4f', '#b2456e', '#f6a04d'], sun: '#ffd27a', land: '#1b1530', water: '#3a2a55' }
const abujaGold = { sky: ['#f4c27a', '#f29a5c', '#c4572e'], sun: '#fff1c1', land: '#3c2a1e', water: '#a8613c' }

// A score prediction thread, wide enough to need "More replies".
const PREDICTIONS: [string, string][] = [
  ['amaka_writes', '2-1 Eagles. Late winner, I can feel it in my bones.'],
  ['tunde_builds', '1-1. Both defences will be sleeping.'],
  ['zainab_abj', '3-0 and I am not even a football person.'],
  ['funke_eats', '2-0. Whoever scores first, I am buying suya for the street.'],
  ['ibrahim_dev', '0-0. Sorry, someone had to be realistic.'],
  ['ngozi_unilag', '2-1! Watching with the whole hostel.'],
  ['segun_beats', '1-0. Ugly win, still a win.'],
  ['chioma_law', '2-2. Chaos, as usual.'],
  ['musa_lens', '3-1. Bringing my camera to the viewing centre.'],
  ['bisi_mum', '1-0, and then my husband will not sleep.'],
  ['emeka_ng', '2-1. Osimhen header from a corner.'],
  ['halima_reads', 'I will just say Nigeria wins. Numbers are your business.'],
  ['dayo_runs', '4-2. Pure entertainment, zero defending.'],
]
const MORE_PREDICTIONS = [
  '2-0. Clean sheet for once.', '1-2. I hope I am wrong.', '2-1 to us.', '3-2, heart attack edition.', '1-1, penalties in my dreams.',
  '2-0, both in the second half.', '0-1. Say it with me: I hope I am wrong.', '2-1, comeback win.', '1-0 from a free kick.',
  '3-1, Lookman brace.', '2-2. The ref will be the main character.', '1-0, but we will suffer for 90 minutes.', '2-1. Same as always.',
  '3-0. Manifesting.', '2-1 and I am going to bed happy.', '1-1, honest result.', '0-0 at half time, 2-0 at full time.',
  '2-1, VAR drama included.', '1-0. Defence wins matches.', '2-0. Cleanest game of the year.', '3-1, and Ghana fans go quiet.',
  '2-2, then a fight in the comments.', '1-0. A tap-in from three yards.', '2-1, winner in stoppage time.', '1-3? No. I refuse.',
  '2-0 and nobody gets injured, please.', '2-1, and the keeper is man of the match.', '1-1. Draw like brothers.', '3-2. Bring popcorn.',
  '2-0. My mum predicted this, I am just reporting it.', '1-0 from a corner, mark my words.', '2-1 because vibes.', '0-1, bracing myself.',
]
const predictors = MEMBERS.map((m) => m.handle)

const predictionReplies: DemoReply[] = [
  ...PREDICTIONS.map(([by, text]) => ({ by, text, after: 6 })),
  ...MORE_PREDICTIONS.map((text, i) => ({ by: predictors[(i * 5 + 3) % predictors.length]!, text, after: 4 })),
]
// A conversation on the first page, and one past it, so both kinds of branch can be opened.
predictionReplies[0]!.replies = [
  { by: 'kelechi_fc', text: 'Late winner is the most Nigerian prediction possible.' },
  { by: 'amaka_writes', text: 'We do not do easy wins here. Character development.', replies: [{ by: 'segun_beats', text: 'Character development 😂 I am stealing this.' }] },
  { by: 'dayo_runs', text: 'Locking this in as my prediction too.' },
]
predictionReplies[26]!.replies = [
  { by: 'kelechi_fc', text: 'This is the most confident reply in the whole thread.' },
  { by: 'ngozi_unilag', text: 'Who hurt you?' },
]

export const THREADS: DemoThread[] = [
  {
    by: 'kelechi_fc',
    community: 'entertainment',
    hoursAgo: 20,
    text: 'Super Eagles vs Black Stars tonight. Drop your score prediction below 👇 Closest one gets bragging rights until the next match.',
    images: [{ art: pitch(31), alt: 'A football pitch seen from above, with two teams of players spread across the grass.' }],
    replies: [...predictionReplies, { by: 'kelechi_fc', after: 220, text: 'Full time: 2-1 to us! @amaka_writes called it exactly. Respect. Bragging rights are yours.' }],
  },
  {
    by: 'tunde_builds',
    community: 'tech-careers',
    hoursAgo: 30,
    text: 'Hot take: most Nigerian startups do not need microservices. One boring monolith on one good server will carry you to your first 100k users.',
    images: [{ art: code(41), alt: 'A code editor in a dark theme, with a file list on the left and colourful lines of code.' }],
    replies: [
      {
        by: 'ibrahim_dev',
        text: 'Agree, until the team grows past ten engineers and everyone is stepping on each other in one repo.',
        replies: [
          {
            by: 'tunde_builds',
            text: 'That is a people problem, not an architecture problem. Modules and code owners fix it for a fraction of the cost.',
            replies: [
              {
                by: 'ibrahim_dev',
                text: 'Fair, but deploys? One bad commit and everything goes down at once.',
                replies: [
                  {
                    by: 'emeka_ng',
                    text: 'Feature flags and a rollback button. We deploy a monolith fifteen times a day at work and nobody panics.',
                    replies: [
                      {
                        by: 'ibrahim_dev',
                        text: 'Fifteen times a day? How long does your test suite take?',
                        replies: [
                          {
                            by: 'emeka_ng',
                            text: 'About nine minutes in CI. We split it across runners last quarter. Worth every naira.',
                            replies: [
                              {
                                by: 'tunde_builds',
                                text: 'This is the real lesson. Invest in CI before you invest in Kubernetes.',
                                replies: [
                                  {
                                    by: 'ibrahim_dev',
                                    text: 'Okay, I am half convinced. Writing this down for our next planning meeting.',
                                    replies: [{ by: 'emeka_ng', text: 'Send me the slides when you win the argument 😄' }],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        by: 'amaka_writes',
        text: 'I understood maybe 40% of this but I love watching engineers disagree politely.',
        replies: [{ by: 'tunde_builds', text: 'Polite for now. Wait until someone brings up tabs and spaces.' }],
      },
      { by: 'zainab_abj', text: 'Architects have this exact argument about open-plan offices.' },
      {
        by: 'halima_reads',
        text: 'Saving this. My brother is about to rewrite his app into twelve services for no reason.',
        replies: [{ by: 'tunde_builds', text: 'Send him here before it is too late 🙏' }],
      },
    ],
  },
  {
    by: 'funke_eats',
    community: 'lagos',
    hoursAgo: 26,
    text: 'I rated five buka spots in Surulere this week so you do not have to. Number one shocked me. Full list below 👇',
    images: [
      { art: plate(51, 'jollof'), alt: 'A plate of smoky jollof rice with fried plantain and chicken, seen from above on a wooden table.' },
      { art: plate(52, 'amala'), alt: 'Amala with ewedu and red stew on a white plate.' },
    ],
    replies: [
      {
        by: 'funke_eats',
        text: '5. The canteen on Bode Thomas: solid amala, but the ewedu could be thicker. 6/10.',
        after: 2,
        replies: [
          {
            by: 'funke_eats',
            text: '4. The spot by the filling station on Adeniran Ogunsanya. Rice was smoky, stew was shy. 6.5/10.',
            after: 2,
            replies: [
              {
                by: 'funke_eats',
                text: '3. The orange canopy near the market: the assorted meat alone is worth the trip. 7.5/10.',
                after: 2,
                replies: [
                  {
                    by: 'funke_eats',
                    text: '2. Pounded yam so smooth it should be illegal. Egusi with real stockfish. 8.5/10.',
                    after: 2,
                    images: [{ art: plate(53, 'poundo'), alt: 'Pounded yam beside a generous bowl of egusi soup.' }],
                    replies: [
                      {
                        by: 'funke_eats',
                        text: '1. A tiny place behind the stadium with no name and no sign. Best jollof I have had this year. 9.5/10. Ask for Aunty Bose.',
                        after: 2,
                        replies: [
                          {
                            by: 'kelechi_fc',
                            text: 'Behind the stadium where exactly? I need coordinates.',
                            replies: [{ by: 'funke_eats', text: 'Some places are found, not given 😌' }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        by: 'amaka_writes',
        text: 'Jollof critic reporting for duty. 9.5 is a bold number. I am going this weekend to verify.',
        after: 40,
        replies: [
          {
            by: 'funke_eats',
            text: 'Go hungry. Report back.',
            replies: [{ by: 'amaka_writes', after: 600, text: 'Verified. It is a solid 9. Aunty Bose says I ask too many questions.' }],
          },
        ],
      },
      {
        by: 'bisi_mum',
        text: 'Nothing in Ibadan?? We have the best amala in the country, I am just saying.',
        replies: [
          { by: 'funke_eats', text: 'Ibadan edition next month, I promise.' },
          { by: 'segun_beats', text: 'Ibadan amala stays undefeated. No debate.' },
        ],
      },
    ],
  },
  {
    by: 'musa_lens',
    community: 'abuja',
    hoursAgo: 9,
    text: 'Golden hour at Jabi Lake this evening. The light did all the work.',
    images: [
      { art: skyline(61, { ...abujaGold, horizon: 'trees' }), alt: 'The sun setting behind a line of trees, reflected in a calm orange lake.' },
      { art: skyline(62, { sky: ['#f6d79a', '#f4a259', '#bc4b51'], sun: '#fff4d6', land: '#2d2a26', water: '#c07a4f', horizon: 'trees' }), alt: 'A wooden canoe on the lake under a peach and red sky.' },
      { art: skyline(63, { sky: ['#5e4b8b', '#d77a61', '#f2c57c'], sun: '#ffe9b0', land: '#221c2e', water: '#6d4f7c', horizon: 'trees' }), alt: 'Purple dusk over the lake, with the last of the sun on the water.' },
    ],
    replies: [
      {
        by: 'zainab_abj',
        text: 'Which side is this? I have never seen the water this calm.',
        replies: [
          {
            by: 'musa_lens',
            text: 'The boat club side, around 6:15pm. Get there before six, the light goes fast.',
            images: [{ art: skyline(64, { ...abujaGold, horizon: 'trees', width: 1000, height: 1250 }), alt: 'A tall photo of the lake shore with trees and a low golden sun.' }],
            replies: [{ by: 'zainab_abj', text: 'Going on Saturday. If I fall in the lake, it is on you.' }],
          },
        ],
      },
      {
        by: 'dayo_runs',
        text: 'This is wallpaper material. Do you sell prints?',
        replies: [
          {
            by: 'musa_lens',
            text: 'Not yet, but people keep asking. Maybe this is the sign.',
            replies: [{ by: 'bisi_mum', text: 'Do it! I would buy two for my shop.' }],
          },
        ],
      },
      { by: 'ngozi_unilag', text: 'The second one 😍' },
    ],
  },
  {
    by: 'chioma_law',
    community: 'lagos',
    hoursAgo: 40,
    text: 'Things I wish every first-time renter in Lagos knew. A short thread from someone who reads tenancy agreements for fun 👇',
    replies: [
      {
        by: 'chioma_law',
        after: 1,
        text: '1/ Read the whole agreement before you pay the agent anything. Not after. Before.',
        replies: [
          {
            by: 'chioma_law',
            after: 1,
            text: '2/ Ask who pays for repairs, and get the answer in writing.',
            replies: [
              {
                by: 'chioma_law',
                after: 1,
                text: '3/ Keep every receipt, even for a ₦5,000 water bill. Photograph them too.',
                replies: [
                  {
                    by: 'chioma_law',
                    after: 1,
                    text: '4/ On move-in day, take dated photos of every room. Future you will be grateful.',
                  },
                  {
                    by: 'kelechi_fc',
                    after: 30,
                    deleted: true,
                    text: 'Is a screenshot of a bank transfer enough or do I need the paper one too?',
                    replies: [{ by: 'dayo_runs', text: 'Whatever he asked, he deleted it, but the answer is still yes: keep everything 😂' }],
                  },
                ],
              },
              {
                by: 'ngozi_unilag',
                text: 'What if the agent says the landlord will fix it but will not write it down?',
                replies: [{ by: 'chioma_law', text: 'Then it did not happen. Politely insist. A WhatsApp message from the agent is better than nothing.' }],
              },
            ],
          },
        ],
      },
      { by: 'emeka_ng', after: 50, text: 'Saving this for my younger brother. He moves out this year.' },
    ],
  },
  {
    by: 'ngozi_unilag',
    community: 'universities',
    hoursAgo: 14,
    text: 'Final year project defence is in three weeks and my supervisor just changed my topic. Is this normal or am I being pranked?',
    replies: [
      {
        by: 'halima_reads',
        text: 'Very normal, sadly. Mine changed twice. You will survive, I promise.',
        replies: [
          {
            by: 'ngozi_unilag',
            text: 'Twice?! How did you finish?',
            replies: [{ by: 'halima_reads', text: 'Coffee, prayer and a very patient course rep.' }],
          },
        ],
      },
      { by: 'amaka_writes', text: 'Ask for the new topic in writing so it does not change again in week three.' },
      { by: 'ibrahim_dev', text: 'Same thing happened to me in final year. It turned out better in the end. Hang in there.' },
      {
        by: 'bisi_mum',
        text: 'Rooting for you! Come back and tell us when you pass.',
        replies: [{ by: 'ngozi_unilag', text: 'Deal. I will post a photo of my softbound copy.' }],
      },
    ],
  },
  {
    by: 'segun_beats',
    community: 'entertainment',
    hoursAgo: 5,
    text: 'New beat cooking tonight. Amapiano log drums with a highlife guitar on top. Producers, is that a crime?',
    images: [{ art: studio(71), alt: 'A dark home studio: a screen showing a green waveform above a desk of faders.' }],
    replies: [
      { by: 'kelechi_fc', text: 'If it slaps, it is legal.' },
      {
        by: 'amaka_writes',
        text: 'Highlife guitar makes everything better. Post a snippet!',
        replies: [{ by: 'segun_beats', text: 'Snippet Friday, I promise.' }],
      },
      {
        by: 'zainab_abj',
        text: 'Please credit the guitarist. Session players never get named.',
        replies: [{ by: 'segun_beats', text: 'Always. He is my cousin, he would never forgive me.' }],
      },
    ],
  },
  {
    by: 'ibrahim_dev',
    community: 'tech-careers',
    hoursAgo: 11,
    text: 'Shipped dark mode in our app today. 40% of users switched within the first hour. People really were suffering in silence.',
    replies: [
      {
        by: 'tunde_builds',
        text: '40% in an hour is wild. Did you default it to the system setting?',
        replies: [{ by: 'ibrahim_dev', text: 'Yes. It follows the system by default, with a switch in settings for everyone else.' }],
      },
      { by: 'emeka_ng', text: 'Congrats! Now do the same energy for the onboarding flow 😅' },
    ],
  },
  {
    by: 'bisi_mum',
    hoursAgo: 7,
    text: 'New Ankara stock just landed in the shop! Which one should I make into a dress first?',
    images: [
      { art: ankara(81, ['#f6efe3', '#d9531e', '#1f4e79', '#f2c230', '#2f6b3c'], 'circles'), alt: 'Ankara fabric with orange, blue and yellow concentric circles on cream.' },
      { art: ankara(82, ['#14213d', '#fca311', '#e5e5e5', '#d62828', '#2a9d8f'], 'diamonds'), alt: 'Navy Ankara fabric with gold and red diamonds.' },
      { art: ankara(83, ['#2f6b3c', '#f4c35d', '#c4572e', '#f6efe3', '#14213d'], 'leaves'), alt: 'Green Ankara fabric with yellow and terracotta leaves.' },
      { art: ankara(84, ['#5b3a6e', '#f2c230', '#3ddc97', '#ff7a45', '#f6efe3'], 'waves'), alt: 'Purple Ankara fabric with bright wavy stripes.' },
    ],
    replies: [
      { by: 'zainab_abj', text: 'The third one, no contest.' },
      {
        by: 'ngozi_unilag',
        text: 'First one! The colours are giving owambe.',
        replies: [{ by: 'bisi_mum', text: 'Owambe energy was exactly the plan 😄' }],
      },
      { by: 'halima_reads', text: 'All four. Next question.' },
    ],
  },
  {
    by: 'halima_reads',
    hoursAgo: 32,
    text: 'Our book club met in person for the first time on Saturday. Eleven people, three hours, one heated argument about an ending. Tobi drew the three of us who stayed the latest.',
    images: [
      { art: 'brand-photo', alt: 'An illustration of three friends in green clothes, smiling and talking together.' },
      { art: bookshelf(91), alt: 'A tall wooden bookcase, nearly full, with a small plant beside it.' },
    ],
    replies: [
      {
        by: 'amaka_writes',
        text: 'Which side of the argument were you on?',
        replies: [{ by: 'halima_reads', text: 'The correct one, obviously. Join us next month and find out.' }],
      },
      {
        by: 'chioma_law',
        text: 'Endings always start fights. What is the next pick?',
        replies: [{ by: 'halima_reads', text: 'Something short, so people actually finish it this time. Suggestions welcome.' }],
      },
    ],
  },
  {
    by: 'dayo_runs',
    community: 'lagos',
    hoursAgo: 3,
    text: '6am run across Third Mainland this morning. Just me, the fishermen and one very confused danfo driver.',
    images: [{ art: skyline(101, { ...lagosDusk, sky: ['#3b4b8a', '#e58f65', '#f9d29d'], horizon: 'bridge' }), alt: 'Sunrise over the lagoon, with a long bridge and a distant skyline.' }],
    replies: [
      {
        by: 'musa_lens',
        text: 'That light! What phone is this?',
        replies: [{ by: 'dayo_runs', text: 'An old phone with a cracked screen. The bridge does the rest.' }],
      },
      { by: 'kelechi_fc', text: '6am is not a real time.' },
    ],
  },
  {
    by: 'amaka_writes',
    hoursAgo: 18,
    text: 'Writing tip that changed my life: finish the ugly first draft before you fix a single sentence.',
    replies: [
      {
        by: 'halima_reads',
        text: 'Saving this. I have been editing chapter one for eight months.',
        replies: [{ by: 'amaka_writes', text: 'Eight months! Halima, move to chapter two. Today.' }],
      },
    ],
  },
  {
    by: 'emeka_ng',
    community: 'tech-careers',
    hoursAgo: 22,
    text: 'PSA: if your checkout has more than one "Are you sure?" step, you are losing customers. Ask me how I know.',
    replies: [
      {
        by: 'ibrahim_dev',
        text: 'How do you know?',
        replies: [
          {
            by: 'emeka_ng',
            text: 'We tested it last month. Removing one confirmation screen lifted completed payments by 8%.',
            replies: [{ by: 'tunde_builds', text: '8% for deleting a screen. Best return in tech.' }],
          },
        ],
      },
    ],
  },
  {
    by: 'zainab_abj',
    community: 'abuja',
    hoursAgo: 28,
    text: 'Abuja people: where can I buy indoor plants that will not die in a week?',
    replies: [
      {
        by: 'musa_lens',
        text: 'Any nursery that sells snake plants. Ask for those first, they are unkillable.',
        replies: [{ by: 'zainab_abj', text: 'Unkillable is my love language.' }],
      },
      { by: 'bisi_mum', text: 'Pothos! I have had mine for three years and I forget to water it.' },
    ],
  },
  {
    by: 'musa_lens',
    community: 'abuja',
    hoursAgo: 1,
    images: [{ art: skyline(111, { ...abujaGold, sky: ['#2c3e6b', '#c0614a', '#f4a259'] }), alt: 'Dusk over a city skyline under a deep orange sky.' }],
  },
  {
    by: 'kelechi_fc',
    hoursAgo: 48,
    text: 'Unpopular opinion: the best part of any match is the twenty minutes before kick-off when everyone still believes.',
    replies: [{ by: 'segun_beats', text: 'Hope is free. Results are expensive.' }],
  },
  {
    by: 'zainab_abj',
    hoursAgo: 60,
    text: 'Visited a building site today where the contractor finished a week early. I am still in shock. Miracles happen.',
  },
  {
    by: 'dayo_runs',
    hoursAgo: 70,
    text: 'Week three of training for my first half marathon. Legs are complaining, spirit is willing.',
    replies: [{ by: 'amaka_writes', text: 'Your legs are telling you to come and eat jollof with me instead.' }],
  },
]

export const ANSWERS: DemoAnswer[] = [
  {
    to: { handle: 'psami', startsWith: 'hello Abj' },
    replies: [
      { by: 'zainab_abj', text: 'Welcome to Abuja! Jabi Lake early on a Sunday is the best introduction.' },
      {
        by: 'musa_lens',
        text: 'Abuja people are the friendliest. Do not let Lagos tell you otherwise 😄',
        replies: [{ by: 'dayo_runs', text: 'As a Lagosian I object, but fair.' }],
      },
    ],
  },
  {
    to: { handle: 'chidi', startsWith: 'Third Mainland at 7am' },
    replies: [{ by: 'dayo_runs', text: 'Try it at 6am on foot. It is a different bridge before the danfos wake up.' }],
  },
  {
    to: { handle: 'ada', startsWith: 'Who else is building something' },
    replies: [
      {
        by: 'tunde_builds',
        text: 'Me! A small invoicing tool for tailors. Two customers so far, both my aunties.',
        replies: [{ by: 'ibrahim_dev', text: 'Aunties are the toughest product testers. Ship it.' }],
      },
    ],
  },
  {
    to: { handle: 'bayo', startsWith: 'Best suya spot' },
    replies: [
      { by: 'funke_eats', text: 'My kitchen, right after I burn it.' },
      { by: 'kelechi_fc', text: 'The one that closes five minutes before you arrive.' },
    ],
  },
]
