// The picker's emoji, loaded only when it first opens. One line each: the character,
// its name, then "|" and search words. Names are what a screen reader says.
const GROUPS: [name: string, lines: string][] = [
  ['Smileys', `
😀 grinning face|happy smile
😃 grinning face with big eyes|happy
😄 grinning face with smiling eyes|happy
😁 beaming face with smiling eyes|grin
😆 grinning squinting face|laugh
😅 grinning face with sweat|relief
🤣 rolling on the floor laughing|lol lmao
😂 face with tears of joy|lol laugh cry
🙂 slightly smiling face|smile
🙃 upside-down face|silly
😉 winking face|wink
😊 smiling face with smiling eyes|blush happy
😇 smiling face with halo|angel innocent
🥰 smiling face with hearts|love
😍 smiling face with heart-eyes|love
🤩 star-struck|wow
😘 face blowing a kiss|kiss love
😋 face savoring food|yum tasty
😛 face with tongue|silly
😜 winking face with tongue|silly joke
🤪 zany face|crazy
🤗 smiling face with open hands|hug
🤔 thinking face|hmm
🤭 face with hand over mouth|oops giggle
🤫 shushing face|quiet secret
😐 neutral face|meh
😑 expressionless face|blank
😶 face without mouth|silent
🙄 face with rolling eyes|eyeroll
😏 smirking face|smirk
😒 unamused face|annoyed
😬 grimacing face|awkward
😌 relieved face|calm
😔 pensive face|sad
😪 sleepy face|tired
😴 sleeping face|sleep zzz
😷 face with medical mask|sick
🤒 face with thermometer|ill fever
🤕 face with head-bandage|hurt
🤢 nauseated face|sick
🤮 face vomiting|sick
🥵 hot face|heat
🥶 cold face|freezing
😵 face with crossed-out eyes|dizzy
🤯 exploding head|mind blown
🥳 partying face|celebrate birthday
😎 smiling face with sunglasses|cool
🤓 nerd face|geek
😕 confused face|puzzled
😟 worried face|anxious
😮 face with open mouth|surprised
😲 astonished face|shock
😳 flushed face|embarrassed
🥺 pleading face|please
😢 crying face|sad tear
😭 loudly crying face|sob
😱 face screaming in fear|scared
😖 confounded face|upset
😞 disappointed face|sad
😓 downcast face with sweat|stress
😩 weary face|tired
😫 tired face|exhausted
😤 face with steam from nose|angry proud
😡 enraged face|angry mad
😠 angry face|mad
🤬 face with symbols on mouth|swearing cursing
😈 smiling face with horns|devil
💀 skull|dead
💩 pile of poo|poop
🤡 clown face|clown
👻 ghost|halloween
🙈 see-no-evil monkey|shy
🙉 hear-no-evil monkey|deaf
🙊 speak-no-evil monkey|secret
`],
  ['People', `
👋 waving hand|hello bye
✋ raised hand|stop high five
👌 OK hand|okay perfect
🤌 pinched fingers|italian
✌️ victory hand|peace
🤞 crossed fingers|luck
🤟 love-you gesture|rock
🤘 sign of the horns|rock
👈 backhand index pointing left|point
👉 backhand index pointing right|point
👆 backhand index pointing up|point
👇 backhand index pointing down|point
☝️ index pointing up|point
👍 thumbs up|like yes
👍🏽 thumbs up: medium skin tone|like yes
👍🏿 thumbs up: dark skin tone|like yes
👎 thumbs down|dislike no
✊ raised fist|power
👊 oncoming fist|punch
👏 clapping hands|applause
👏🏽 clapping hands: medium skin tone|applause
👏🏿 clapping hands: dark skin tone|applause
🙌 raising hands|celebrate praise
🙌🏿 raising hands: dark skin tone|celebrate praise
👐 open hands|jazz
🤝 handshake|deal agreement
🙏 folded hands|please thanks pray
🙏🏽 folded hands: medium skin tone|please thanks pray
🙏🏿 folded hands: dark skin tone|please thanks pray
💪 flexed biceps|strong muscle
💪🏽 flexed biceps: medium skin tone|strong muscle
💪🏿 flexed biceps: dark skin tone|strong muscle
🤦 person facepalming|facepalm
🤷 person shrugging|shrug idk
🤦🏿 person facepalming: dark skin tone|facepalm
🤷🏿 person shrugging: dark skin tone|shrug idk
🙋 person raising hand|question
💃 woman dancing|dance party
🕺 man dancing|dance party
🚶 person walking|walk
🏃 person running|run
👀 eyes|look see
👂 ear|listen
👄 mouth|lips
🧠 brain|mind
👶 baby|child
👦 boy|child
👧 girl|child
👨 man|adult
👩 woman|adult
👴 old man|elder
👵 old woman|elder
👨‍👩‍👧 family: man, woman, girl|parents
👩‍❤️‍👨 couple with heart: woman, man|love
👨‍💻 man technologist|developer coder
👩‍💻 woman technologist|developer coder
👩🏿‍💻 woman technologist: dark skin tone|developer coder
🧑‍🍳 cook|chef
`],
  ['Animals', `
🐶 dog face|puppy pet
🐱 cat face|kitten pet
🐭 mouse face|rodent
🐹 hamster|pet
🐰 rabbit face|bunny
🦊 fox|animal
🐻 bear|animal
🐼 panda|animal
🐨 koala|animal
🐯 tiger face|animal
🦁 lion|animal
🐮 cow face|animal
🐷 pig face|animal
🐸 frog|animal
🐵 monkey face|animal
🐔 chicken|hen
🐧 penguin|bird
🐦 bird|tweet
🦅 eagle|bird
🦉 owl|bird
🐴 horse face|animal
🦄 unicorn|magic
🐝 honeybee|insect
🦋 butterfly|insect
🐛 bug|insect
🐢 turtle|slow
🐍 snake|reptile
🐙 octopus|sea
🐠 tropical fish|sea
🐬 dolphin|sea
🐳 spouting whale|sea
🦈 shark|sea
🐘 elephant|animal
🦒 giraffe|animal
🐐 goat|animal
🐓 rooster|cock
🌸 cherry blossom|flower
🌹 rose|flower
🌻 sunflower|flower
🌴 palm tree|tropical
🌳 deciduous tree|nature
🌱 seedling|plant
🍀 four leaf clover|luck
🌍 globe showing Europe-Africa|world earth
🌙 crescent moon|night
⭐ star|favorite
🌟 glowing star|sparkle
✨ sparkles|shine magic
☀️ sun|sunny weather
🌤️ sun behind small cloud|weather
🌧️ cloud with rain|weather
⛈️ cloud with lightning and rain|storm
🌈 rainbow|colours
🔥 fire|hot lit
💧 droplet|water
🌊 water wave|sea ocean
`],
  ['Food', `
🍎 red apple|fruit
🍊 tangerine|orange fruit
🍋 lemon|fruit
🍌 banana|fruit
🍉 watermelon|fruit
🍇 grapes|fruit
🍓 strawberry|fruit
🍍 pineapple|fruit
🥭 mango|fruit
🥑 avocado|fruit
🍅 tomato|vegetable
🌶️ hot pepper|spicy pepper
🥕 carrot|vegetable
🌽 ear of corn|maize
🥔 potato|vegetable
🍠 roasted sweet potato|yam
🍞 bread|loaf
🥐 croissant|bread
🧀 cheese wedge|dairy
🥚 egg|breakfast
🍳 cooking|fried egg
🍗 poultry leg|chicken
🍖 meat on bone|meat
🥩 cut of meat|steak
🍔 hamburger|burger
🍟 french fries|chips
🍕 pizza|slice
🌭 hot dog|sausage
🌮 taco|mexican
🍜 steaming bowl|noodles soup
🍲 pot of food|stew soup
🍛 curry rice|rice
🍚 cooked rice|rice
🍣 sushi|fish
🍦 soft ice cream|dessert
🍩 doughnut|dessert
🍪 cookie|biscuit
🎂 birthday cake|party
🍰 shortcake|dessert
🍫 chocolate bar|sweet
🍬 candy|sweet
☕ hot beverage|coffee tea
🍵 teacup without handle|tea
🥤 cup with straw|soda drink
🍺 beer mug|drink
🍻 clinking beer mugs|cheers
🥂 clinking glasses|cheers champagne
🍷 wine glass|drink
🥥 coconut|fruit
🍯 honey pot|sweet
`],
  ['Activities', `
⚽ soccer ball|football
🏀 basketball|sport
🏈 american football|sport
🎾 tennis|sport
🏐 volleyball|sport
🏓 ping pong|table tennis
🥊 boxing glove|fight
🏆 trophy|winner cup
🥇 1st place medal|gold winner
🥈 2nd place medal|silver
🥉 3rd place medal|bronze
🎯 bullseye|target
🎮 video game|controller gaming
🎲 game die|dice
♟️ chess pawn|chess
🎵 musical note|music
🎶 musical notes|music
🎤 microphone|sing
🎧 headphone|music
🎸 guitar|music
🥁 drum|music
🎹 musical keyboard|piano
🎬 clapper board|movie film
🎨 artist palette|art
🎉 party popper|celebrate congratulations
🎊 confetti ball|celebrate
🎈 balloon|party
🎁 wrapped gift|present
🪘 long drum|music
`],
  ['Travel', `
🚗 automobile|car
🚕 taxi|cab
🚌 bus|transport
🚑 ambulance|emergency
🚓 police car|police
🚒 fire engine|fire
🏍️ motorcycle|okada bike
🚲 bicycle|bike
🛺 auto rickshaw|keke tricycle
🚆 train|rail
✈️ airplane|flight plane
🚀 rocket|launch
⛵ sailboat|boat
🚢 ship|boat
⛽ fuel pump|petrol
🚦 vertical traffic light|traffic
🏠 house|home
🏢 office building|work
🏥 hospital|health
🏫 school|education
⛪ church|worship
🕌 mosque|worship
🏖️ beach with umbrella|holiday
⛰️ mountain|nature
🌆 cityscape at dusk|city
🌃 night with stars|city night
🗺️ world map|travel
🧭 compass|direction
`],
  ['Objects', `
📱 mobile phone|phone
📞 telephone receiver|call
💻 laptop|computer
🖥️ desktop computer|computer
⌨️ keyboard|typing
📷 camera|photo
📹 video camera|film
📺 television|tv
🔋 battery|power
🔌 electric plug|power
💡 light bulb|idea
🔦 flashlight|torch
💰 money bag|cash
💵 dollar banknote|cash money
💳 credit card|pay
💸 money with wings|spend
🧾 receipt|bill
📦 package|parcel
📚 books|read
📖 open book|read
📝 memo|note write
✏️ pencil|write
📌 pushpin|pin
📎 paperclip|attach
🔒 locked|secure
🔑 key|unlock
🔔 bell|notification
📢 loudspeaker|announce
📣 megaphone|announce
⏰ alarm clock|time
⌛ hourglass done|time
🔍 magnifying glass tilted left|search
🛠️ hammer and wrench|tools
⚙️ gear|settings
🧰 toolbox|tools
💊 pill|medicine
🩺 stethoscope|doctor
👕 t-shirt|clothes
👗 dress|clothes
👟 running shoe|sneaker
👑 crown|king queen
💎 gem stone|diamond
🕶️ sunglasses|cool
🎒 backpack|school
🧳 luggage|travel
`],
  ['Symbols', `
❤️ red heart|love
🧡 orange heart|love
💛 yellow heart|love
💚 green heart|love
💙 blue heart|love
💜 purple heart|love
🖤 black heart|love
🤍 white heart|love
🤎 brown heart|love
💔 broken heart|sad
❤️‍🔥 heart on fire|passion
💕 two hearts|love
💖 sparkling heart|love
💗 growing heart|love
💘 heart with arrow|love cupid
💯 hundred points|perfect score
✅ check mark button|done yes
☑️ check box with check|done
❌ cross mark|no wrong
❎ cross mark button|no
❗ red exclamation mark|alert
❓ red question mark|question
‼️ double exclamation mark|alert
⚠️ warning|caution
🚫 prohibited|forbidden no
⭕ hollow red circle|circle
💤 zzz|sleep
💬 speech balloon|chat comment
💭 thought balloon|think
➕ plus|add
➖ minus|subtract
➡️ right arrow|next
⬅️ left arrow|back
⬆️ up arrow|up
⬇️ down arrow|down
🔁 repeat button|loop
🔄 counterclockwise arrows button|refresh
♻️ recycling symbol|recycle
✔️ check mark|done
©️ copyright|legal
™️ trade mark|brand
🆗 OK button|okay
🆕 NEW button|new
🔝 TOP arrow|top
🔴 red circle|red
🟢 green circle|green
🔵 blue circle|blue
`],
  ['Flags', `
🇳🇬 flag: Nigeria|naija 9ja
🇬🇭 flag: Ghana|africa
🇰🇪 flag: Kenya|africa
🇿🇦 flag: South Africa|africa
🇪🇬 flag: Egypt|africa
🇨🇲 flag: Cameroon|africa
🇸🇳 flag: Senegal|africa
🇬🇧 flag: United Kingdom|uk britain
🇺🇸 flag: United States|usa america
🇨🇦 flag: Canada|north america
🇫🇷 flag: France|europe
🇩🇪 flag: Germany|europe
🇧🇷 flag: Brazil|south america
🇮🇳 flag: India|asia
🇨🇳 flag: China|asia
🇯🇵 flag: Japan|asia
🇦🇪 flag: United Arab Emirates|dubai uae
🏁 chequered flag|race finish
🚩 triangular flag|red flag
🏳️‍🌈 rainbow flag|pride
`],
]

export type Emoji = { char: string; name: string; words: string }
export type EmojiGroup = { name: string; emoji: Emoji[] }

function parse(lines: string): Emoji[] {
  return lines
    .trim()
    .split('\n')
    .map((line) => {
      const space = line.indexOf(' ')
      const [name = '', words = ''] = line.slice(space + 1).split('|')
      return { char: line.slice(0, space), name, words }
    })
}

export const EMOJI_GROUPS: EmojiGroup[] = GROUPS.map(([name, lines]) => ({ name, emoji: parse(lines) }))

/** Emoji whose name or search words contain every word of `query`. */
export function searchEmoji(query: string): Emoji[] {
  const needles = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (needles.length === 0) return []
  const seen = new Set<string>()
  return EMOJI_GROUPS.flatMap((g) => g.emoji).filter((e) => {
    if (seen.has(e.char)) return false
    const hay = `${e.name} ${e.words}`.toLowerCase()
    if (!needles.every((n) => hay.includes(n))) return false
    seen.add(e.char)
    return true
  })
}

/** The entry for a remembered emoji, if the picker has it. */
export function emojiFor(char: string): Emoji | undefined {
  return EMOJI_GROUPS.flatMap((g) => g.emoji).find((e) => e.char === char)
}
