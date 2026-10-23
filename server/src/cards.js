// Ortak kart yardımcıları. 52 kart, kimlik 0..51:
//   renk = id / 13  (0 maça ♠, 1 kupa ♥, 2 karo ♦, 3 sinek ♣ — istemcideki CardSuit sırası)
//   değer = id % 13 + 2  (2..10, 11 vale, 12 kız, 13 papaz, 14 as)

var SPADES = 0;
var HEARTS = 1;
var DIAMONDS = 2;
var CLUBS = 3;
var JACK = 11;
var ACE = 14;

function cardSuit(id) {
  return Math.floor(id / 13);
}

function cardRank(id) {
  return (id % 13) + 2;
}

function cardId(suit, rank) {
  return suit * 13 + (rank - 2);
}

function shuffledCards(rng) {
  var deck = [];
  for (var i = 0; i < 52; i++) deck.push(i);
  for (var j = deck.length - 1; j > 0; j--) {
    var k = Math.floor(rng() * (j + 1));
    var t = deck[j];
    deck[j] = deck[k];
    deck[k] = t;
  }
  return deck;
}

/** İstemciye kart: {id, s, r}. */
function cardView(id) {
  return { id: id, s: cardSuit(id), r: cardRank(id) };
}

function withoutCard(list, id) {
  var at = list.indexOf(id);
  if (at < 0) return list;
  return list.slice(0, at).concat(list.slice(at + 1));
}

var SUIT_NAMES = ['maça', 'kupa', 'karo', 'sinek'];
var RANK_NAMES = { 11: 'vale', 12: 'kız', 13: 'papaz', 14: 'as' };

function cardName(id) {
  var r = cardRank(id);
  return SUIT_NAMES[cardSuit(id)] + ' ' + (RANK_NAMES[r] || String(r));
}
