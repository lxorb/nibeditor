//! What an agent may do, and what it always asks first, recognised from the page rather
//! than from the agent's own account of it (docs/agent-native.md 9.2 to 9.4).
//!
//! An agent that has been talked into buying something will describe the press as
//! whatever it was told to; the card field is still a card field. So the questions are
//! answered from what the page says about the element being pressed and the form it is
//! in - its `autocomplete`, its type, its label, the words on the button - and from where
//! the page is, never from the agent:
//!
//! | category | recognised by |
//! | --- | --- |
//! | paying | a press in a form with a card field, a press whose name reads as paying in any of nib's languages, a submit on a page that talks to a payment processor, a page going to one |
//! | sending | a press named send, post, reply, publish or submit on a mail, messaging or social site |
//! | deleting | a press named delete, remove or erase |
//! | signing in | a password field, or any field of a form with one: never typed, a takeover |
//!
//! Sites are registrable domains. A rule for `bank.example` covers `www.bank.example`
//! and `login.bank.example`, which is what the reader means by the bank; the reader's
//! rules are matched by that suffix, and a site this crate names for a question is the
//! host's last two labels, or three under a two-letter country code's own second level
//! (`bbc.co.uk`).
//!
//! Pure: every function here reads what it is given, so the tables are tested in every
//! language they cover.

use serde::Deserialize;

use super::grants::{Grant, Mode, SiteRule};
use super::verbs::{Category, Store};

/// The host of an address, lower case.
pub fn host_of(url: &str) -> Option<String> {
    let parsed: tauri::Url = url.parse().ok()?;
    parsed.host_str().map(str::to_lowercase)
}

/// The site a host is on: its registrable domain, as far as it can be told without the
/// public suffix list.
pub fn site_of(host: &str) -> String {
    let host = host.trim_end_matches('.').to_lowercase();
    if host.parse::<std::net::IpAddr>().is_ok() || !host.contains('.') {
        return host;
    }
    let labels: Vec<&str> = host.split('.').collect();
    let keep = match labels.as_slice() {
        [.., second, top]
            if top.len() == 2
                && matches!(
                    *second,
                    "co" | "com"
                        | "org"
                        | "net"
                        | "ac"
                        | "gov"
                        | "edu"
                        | "or"
                        | "ne"
                        | "go"
                        | "gob"
                        | "nic"
                        | "mil"
                        | "ltd"
                        | "plc"
                ) =>
        {
            3
        }
        _ => 2,
    };
    labels[labels.len().saturating_sub(keep)..].join(".")
}

/// The reader's rule for a host, by the longest site in the grant that covers it.
pub fn rule_for(grant: &Grant, host: &str) -> Option<SiteRule> {
    grant
        .sites
        .iter()
        .filter(|(site, _)| covers(site, host))
        .max_by_key(|(site, _)| site.len())
        .map(|(_, rule)| *rule)
}

/// Whether a site the reader named covers a host.
fn covers(site: &str, host: &str) -> bool {
    let site = site.trim().trim_start_matches("*.").to_lowercase();
    host == site || host.ends_with(&format!(".{site}"))
}

/// Whether an agent may be at an address in a tab of this store: a denied site nowhere,
/// a site kept to the agent's own store only there.
pub fn site_allowed(grant: &Grant, url: &str, store: Store) -> Result<(), String> {
    let Some(host) = host_of(url) else {
        return Ok(());
    };
    match rule_for(grant, &host) {
        Some(SiteRule::Deny) => Err(format!("{} is denied to this agent", site_of(&host))),
        Some(SiteRule::AgentStore) if store != Store::Agent => Err(format!(
            "{} is only for this agent's own store: open it with store \"agent\"",
            site_of(&host)
        )),
        _ => Ok(()),
    }
}

/// `site_allowed` for an agent by id, from the grants already read; the reader's own
/// command line and an agent whose grant is gone may go anywhere the page goes.
pub fn site_allowed_for(agent: &str, url: &str, store: Store) -> Result<(), String> {
    match super::grants::cached(agent) {
        Some(grant) => site_allowed(&grant, url, store),
        None => Ok(()),
    }
}

/// Whether an agent may run script on a page at this host (9.2): `browser.script` and
/// the site on its list.
pub fn script_allowed(grant: &Grant, host: &str) -> bool {
    grant.scripts.iter().any(|site| covers(site, host))
}

/// What the page says about the element being acted on, read by `FACTS` in the page.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Facts {
    /// Its tag, lower case.
    pub tag: String,
    /// An input's type, lower case.
    #[serde(rename = "type")]
    pub kind: String,
    /// What it says: its label, its text, its value for a button.
    pub name: String,
    /// Its `autocomplete`.
    pub autocomplete: String,
    /// Whether pressing it submits a form.
    pub submit: bool,
    /// Whether words can be typed into it.
    pub editable: bool,
    /// Whether it is in a form.
    pub in_form: bool,
    /// The form's fields, or the page's when it is in none.
    pub fields: Vec<Field>,
}

/// One field of the form the element is in.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Field {
    /// Its type.
    #[serde(rename = "type")]
    pub kind: String,
    /// Its `autocomplete`.
    pub autocomplete: String,
    /// Its name, id, label and placeholder, joined.
    pub said: String,
}

impl Facts {
    /// Whether it is a password field.
    pub fn password(&self) -> bool {
        self.kind == "password"
    }

    /// Whether it is in a sign-in form: a form with a password field.
    pub fn sign_in(&self) -> bool {
        self.in_form && self.fields.iter().any(|one| one.kind == "password")
    }

    /// Whether its form asks for a card.
    pub fn card_form(&self) -> bool {
        self.in_form && self.fields.iter().any(card_field)
    }

    /// Whether it is a field an agent's typing into is kept out of the log.
    pub fn sensitive(&self) -> bool {
        self.password()
            || self.autocomplete.starts_with("cc-")
            || self.autocomplete.contains("one-time-code")
            || card_field(&Field {
                kind: self.kind.clone(),
                autocomplete: self.autocomplete.clone(),
                said: self.name.clone(),
            })
    }

    /// Whether it opens one of the engine's own pickers when pressed (6.5).
    pub fn picker(&self) -> bool {
        self.tag == "select"
            || (self.tag == "input"
                && matches!(
                    self.kind.as_str(),
                    "date" | "datetime-local" | "month" | "week" | "time" | "color"
                ))
    }
}

/// Whether a field asks for a card: by `autocomplete`, or by what it is called.
fn card_field(field: &Field) -> bool {
    if field.autocomplete.split_whitespace().any(|one| {
        matches!(
            one,
            "cc-number" | "cc-csc" | "cc-exp" | "cc-exp-month" | "cc-exp-year"
        )
    }) {
        return true;
    }
    let said = field.said.to_lowercase();
    CARD.iter().any(|one| said.contains(one))
}

/// A press, judged: the category it asks under and the one line the reader reads, or
/// nothing to ask about.
pub struct Question {
    /// What it is about.
    pub category: Category,
    /// `Place order on shop.example`.
    pub summary: String,
}

/// What an agent is doing to the element the facts are about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Act {
    /// Pressing it, or Enter in it.
    Press,
    /// Typing into it or setting it.
    Write,
}

/// What a press or a write asks first, for an agent with this grant on a page at `url`
/// that has talked to `hosts`. `None` when it goes ahead.
pub fn judge(
    grant: &Grant,
    facts: &Facts,
    act: Act,
    url: &str,
    hosts: &[String],
) -> Option<Question> {
    let host = host_of(url).unwrap_or_default();
    let site = site_of(&host);
    let label = short(&facts.name);
    let ask = |category: Category, summary: String| {
        (grant.asks(category) && !grant.always(&site, category))
            .then_some(Question { category, summary })
    };

    if act == Act::Press {
        let paying = facts.card_form()
            || says(&facts.name, PAYING)
            || (facts.submit && hosts.iter().any(|one| payment_host(one)));
        if paying {
            if let Some(question) = ask(Category::Paying, on(&label, "Pay", &site)) {
                return Some(question);
            }
        }
        if says(&facts.name, SENDING) && social(&host) {
            if let Some(question) = ask(Category::Sending, on(&label, "Send", &site)) {
                return Some(question);
            }
        }
        if says(&facts.name, DELETING) {
            if let Some(question) = ask(Category::Deleting, on(&label, "Delete", &site)) {
                return Some(question);
            }
        }
    }

    // Confirm mode asks for every write, pressing included (9.3).
    (grant.mode == Mode::Confirm)
        .then(|| {
            let what = if label.is_empty() {
                "a change".to_string()
            } else {
                format!("\u{201c}{label}\u{201d}")
            };
            ask(Category::Writing, format!("{what} on {site}"))
        })
        .flatten()
}

/// A one-line summary: the press's own words, or a word for the category, and the site.
fn on(label: &str, fallback: &str, site: &str) -> String {
    let what = if label.is_empty() { fallback } else { label };
    format!("{what} on {site}")
}

/// A name cut to one short line.
fn short(name: &str) -> String {
    let flat = name.split_whitespace().collect::<Vec<_>>().join(" ");
    match flat.char_indices().nth(60) {
        Some((at, _)) => format!("{}\u{2026}", &flat[..at]),
        None => flat,
    }
}

/// Whether a name says one of the words: as a whole word where the language puts spaces
/// between words, and anywhere in it where it does not.
pub fn says(name: &str, words: &[&str]) -> bool {
    let name = name.to_lowercase();
    words.iter().any(|word| {
        if !spaced(word) {
            return name.contains(word);
        }
        name.match_indices(word).any(|(at, found)| {
            let before = name[..at].chars().next_back();
            let after = name[at + found.len()..].chars().next();
            before.is_none_or(|one| !one.is_alphanumeric())
                && after.is_none_or(|one| !one.is_alphanumeric())
        })
    })
}

/// Whether a word is written in a script that puts spaces between words, where a match
/// inside another word ("sil" in "silver") is no match.
fn spaced(word: &str) -> bool {
    !word.chars().any(|one| {
        matches!(u32::from(one),
            0x0E00..=0x0EFF      // Thai, Lao
            | 0x1000..=0x109F    // Myanmar
            | 0x1100..=0x11FF    // Hangul jamo
            | 0x2E80..=0x9FFF    // CJK, kana
            | 0xAC00..=0xD7AF    // Hangul
            | 0xF900..=0xFAFF    // CJK compatibility
            | 0x0900..=0x0DFF    // the Indic scripts, whose words take endings
        )
    })
}

/// Whether a host is a known payment processor's.
pub fn payment_host(host: &str) -> bool {
    PAYMENT_HOSTS.iter().any(|one| covers(one, host))
}

/// Whether a host is a mail, messaging or social site, where a send is a send.
pub fn social(host: &str) -> bool {
    SOCIAL.iter().any(|one| covers(one, host))
}

/// What card fields are called, in names, ids and labels.
const CARD: &[&str] = &[
    "cardnumber",
    "card-number",
    "card_number",
    "card number",
    "ccnum",
    "cc-num",
    "cc_num",
    "creditcard",
    "credit-card",
    "credit card",
    "cvc",
    "cvv",
    "csc",
    "securitycode",
    "security code",
    "security-code",
    "card verification",
    "expiry",
    "expiration",
    "exp-date",
    "exp_date",
    "expdate",
    "valid thru",
    "kartennummer",
    "kreditkarte",
    "pr\u{fc}fnummer",
    "ablaufdatum",
    "g\u{fc}ltig bis",
    "num\u{e9}ro de carte",
    "cryptogramme",
    "date d'expiration",
    "n\u{fa}mero de tarjeta",
    "fecha de caducidad",
    "c\u{f3}digo de seguridad",
    "numero della carta",
    "codice di sicurezza",
    "n\u{fa}mero do cart\u{e3}o",
    "c\u{f3}digo de seguran\u{e7}a",
    "numer karty",
    "\u{43d}\u{43e}\u{43c}\u{435}\u{440} \u{43a}\u{430}\u{440}\u{442}\u{44b}",
    "\u{43d}\u{43e}\u{43c}\u{435}\u{440} \u{43a}\u{430}\u{440}\u{442}\u{43a}\u{438}",
    "\u{30ab}\u{30fc}\u{30c9}\u{756a}\u{53f7}",
    "\u{30bb}\u{30ad}\u{30e5}\u{30ea}\u{30c6}\u{30a3}\u{30b3}\u{30fc}\u{30c9}",
    "\u{5361}\u{53f7}",
    "\u{5361}\u{865f}",
    "\u{5b89}\u{5168}\u{7801}",
    "\u{ce74}\u{b4dc} \u{bc88}\u{d638}",
    "kart numaras\u{131}",
    "s\u{1ed1} th\u{1ebb}",
    "nomor kartu",
];

/// Presses that pay, in every language nib has a catalogue for.
pub const PAYING: &[&str] = &[
    // English
    "pay", "pay now", "buy", "buy now", "place order", "place your order", "checkout",
    "check out", "confirm purchase", "complete purchase", "complete order", "submit order",
    "confirm order", "purchase", "order now",
    // German, Swiss German
    "bezahlen", "jetzt bezahlen", "kaufen", "jetzt kaufen", "zahlungspflichtig bestellen",
    "kostenpflichtig bestellen", "bestellung abschlie\u{df}en", "kauf abschlie\u{df}en",
    "zur kasse", "zahle", "chaufe",
    // French
    "payer", "acheter", "commander", "passer la commande", "valider la commande",
    "confirmer l'achat", "finaliser la commande", "paiement",
    // Spanish
    "pagar", "comprar", "realizar pedido", "finalizar compra", "confirmar compra",
    "tramitar pedido", "hacer pedido",
    // Italian
    "paga", "acquista", "compra", "effettua ordine", "conferma ordine",
    "procedi all'acquisto", "concludi ordine",
    // Portuguese
    "fazer pedido", "finalizar pedido", "encomendar",
    // Polish
    "zap\u{142}a\u{107}", "kup", "kup teraz", "zamawiam", "zam\u{f3}w",
    "z\u{142}\u{f3}\u{17c} zam\u{f3}wienie", "kupuj\u{119} i p\u{142}ac\u{119}",
    // Russian, Ukrainian
    "\u{43e}\u{43f}\u{43b}\u{430}\u{442}\u{438}\u{442}\u{44c}", "\u{43a}\u{443}\u{43f}\u{438}\u{442}\u{44c}",
    "\u{43e}\u{444}\u{43e}\u{440}\u{43c}\u{438}\u{442}\u{44c} \u{437}\u{430}\u{43a}\u{430}\u{437}",
    "\u{437}\u{430}\u{43a}\u{430}\u{437}\u{430}\u{442}\u{44c}",
    "\u{43e}\u{43f}\u{43b}\u{430}\u{442}\u{438}\u{442}\u{438}", "\u{43a}\u{443}\u{43f}\u{438}\u{442}\u{438}",
    "\u{43e}\u{444}\u{43e}\u{440}\u{43c}\u{438}\u{442}\u{438} \u{437}\u{430}\u{43c}\u{43e}\u{432}\u{43b}\u{435}\u{43d}\u{43d}\u{44f}",
    "\u{437}\u{430}\u{43c}\u{43e}\u{432}\u{438}\u{442}\u{438}",
    // Turkish
    "\u{f6}de", "\u{f6}deme yap", "sat\u{131}n al", "sipari\u{15f}i tamamla", "sipari\u{15f} ver",
    // Indonesian, Malay, Javanese, Filipino
    "bayar", "beli", "beli sekarang", "buat pesanan", "tuku", "magbayad", "bumili", "bilhin",
    "mag-order",
    // Swahili, Hausa, Amharic
    "lipa", "nunua", "agiza", "biya", "saya", "\u{12ed}\u{12ad}\u{1348}\u{1209}", "\u{130d}\u{12db}",
    // Arabic, Persian, Pashto, Urdu
    "\u{627}\u{62f}\u{641}\u{639}", "\u{62f}\u{641}\u{639}", "\u{634}\u{631}\u{627}\u{621}",
    "\u{627}\u{634}\u{62a}\u{631}", "\u{625}\u{62a}\u{645}\u{627}\u{645} \u{627}\u{644}\u{637}\u{644}\u{628}",
    "\u{62a}\u{623}\u{643}\u{64a}\u{62f} \u{627}\u{644}\u{637}\u{644}\u{628}",
    "\u{67e}\u{631}\u{62f}\u{627}\u{62e}\u{62a}", "\u{62e}\u{631}\u{6cc}\u{62f}",
    "\u{62b}\u{628}\u{62a} \u{633}\u{641}\u{627}\u{631}\u{634}", "\u{62a}\u{627}\u{62f}\u{6cc}\u{647}",
    "\u{627}\u{62f}\u{627}\u{626}\u{6cc}\u{6af}\u{6cc}", "\u{62e}\u{631}\u{6cc}\u{62f}\u{6cc}\u{6ba}",
    // Hindi, Marathi, Bengali, Gujarati, Punjabi
    "\u{92d}\u{941}\u{917}\u{924}\u{93e}\u{928}", "\u{916}\u{930}\u{940}\u{926}\u{947}\u{902}",
    "\u{911}\u{930}\u{94d}\u{921}\u{930} \u{915}\u{930}\u{947}\u{902}", "\u{916}\u{930}\u{947}\u{926}\u{940}",
    "\u{9aa}\u{9c7}\u{9ae}\u{9c7}\u{9a8}\u{9cd}\u{99f}", "\u{995}\u{9bf}\u{9a8}\u{9c1}\u{9a8}",
    "\u{a9a}\u{ac1}\u{a95}\u{ab5}\u{aa3}\u{ac0}", "\u{a96}\u{ab0}\u{ac0}\u{aa6}\u{acb}",
    "\u{a2d}\u{a41}\u{a17}\u{a24}\u{a3e}\u{a28}", "\u{a16}\u{a30}\u{a40}\u{a26}\u{a4b}",
    // Tamil, Telugu, Kannada, Malayalam
    "\u{b9a}\u{bc6}\u{bb2}\u{bc1}\u{ba4}\u{bcd}\u{ba4}\u{bc1}", "\u{bb5}\u{bbe}\u{b99}\u{bcd}\u{b95}\u{bc1}",
    "\u{c1a}\u{c46}\u{c32}\u{c4d}\u{c32}\u{c3f}\u{c02}\u{c1a}", "\u{c15}\u{c4a}\u{c28}\u{c41}\u{c17}\u{c4b}\u{c32}\u{c41}",
    "\u{caa}\u{cbe}\u{cb5}\u{ca4}\u{cbf}\u{cb8}\u{cbf}", "\u{c96}\u{cb0}\u{cc0}\u{ca6}\u{cbf}\u{cb8}\u{cbf}",
    "\u{d2a}\u{d23}\u{d2e}\u{d1f}\u{d2f}\u{d4d}\u{d15}\u{d4d}\u{d15}\u{d41}\u{d15}", "\u{d35}\u{d3e}\u{d19}\u{d4d}\u{d19}\u{d41}\u{d15}",
    // Thai, Burmese, Vietnamese
    "\u{e0a}\u{e33}\u{e23}\u{e30}\u{e40}\u{e07}\u{e34}\u{e19}", "\u{e2a}\u{e31}\u{e48}\u{e07}\u{e0b}\u{e37}\u{e49}\u{e2d}",
    "\u{1004}\u{103d}\u{1031}\u{1015}\u{1031}\u{1038}\u{1001}\u{103b}\u{1031}", "\u{101d}\u{101a}\u{103a}",
    "thanh to\u{e1}n", "mua ngay", "\u{111}\u{1eb7}t h\u{e0}ng", "\u{111}\u{1eb7}t mua",
    // Japanese, Korean, Chinese
    "\u{652f}\u{6255}", "\u{8cfc}\u{5165}", "\u{6ce8}\u{6587}\u{3059}\u{308b}", "\u{6ce8}\u{6587}\u{3092}\u{78ba}\u{5b9a}",
    "\u{30ec}\u{30b8}\u{306b}\u{9032}\u{3080}", "\u{acb0}\u{c81c}", "\u{ad6c}\u{b9e4}", "\u{c8fc}\u{bb38}\u{d558}\u{ae30}",
    "\u{652f}\u{4ed8}", "\u{4ed8}\u{6b3e}", "\u{8d2d}\u{4e70}", "\u{63d0}\u{4ea4}\u{8ba2}\u{5355}", "\u{7ed3}\u{7b97}",
    "\u{4e0b}\u{5355}", "\u{8cfc}\u{8cb7}", "\u{63d0}\u{4ea4}\u{8a02}\u{55ae}", "\u{7d50}\u{5e33}", "\u{4e0b}\u{55ae}",
    "\u{4fbe}\u{9322}", "\u{843d}\u{55ae}",
];

/// Presses that send, publish or post, in every language nib has a catalogue for.
pub const SENDING: &[&str] = &[
    "send",
    "post",
    "reply",
    "publish",
    "submit",
    "tweet",
    "reply all",
    "senden",
    "absenden",
    "posten",
    "ver\u{f6}ffentlichen",
    "antworten",
    "abschicken",
    "envoyer",
    "publier",
    "r\u{e9}pondre",
    "soumettre",
    "poster",
    "enviar",
    "publicar",
    "responder",
    "invia",
    "pubblica",
    "rispondi",
    "submeter",
    "wy\u{15b}lij",
    "opublikuj",
    "odpowiedz",
    "prze\u{15b}lij",
    "\u{43e}\u{442}\u{43f}\u{440}\u{430}\u{432}\u{438}\u{442}\u{44c}",
    "\u{43e}\u{43f}\u{443}\u{431}\u{43b}\u{438}\u{43a}\u{43e}\u{432}\u{430}\u{442}\u{44c}",
    "\u{43e}\u{442}\u{432}\u{435}\u{442}\u{438}\u{442}\u{44c}",
    "\u{43d}\u{430}\u{434}\u{456}\u{441}\u{43b}\u{430}\u{442}\u{438}",
    "\u{43e}\u{43f}\u{443}\u{431}\u{43b}\u{456}\u{43a}\u{443}\u{432}\u{430}\u{442}\u{438}",
    "\u{432}\u{456}\u{434}\u{43f}\u{43e}\u{432}\u{456}\u{441}\u{442}\u{438}",
    "g\u{f6}nder",
    "yay\u{131}nla",
    "yan\u{131}tla",
    "kirim",
    "hantar",
    "terbitkan",
    "balas",
    "ipadala",
    "sumagot",
    "tuma",
    "chapisha",
    "jibu",
    "aika",
    "wallafa",
    "amsa",
    "\u{120b}\u{12ad}",
    "\u{12ed}\u{120b}\u{12a9}",
    "\u{625}\u{631}\u{633}\u{627}\u{644}",
    "\u{623}\u{631}\u{633}\u{644}",
    "\u{646}\u{634}\u{631}",
    "\u{627}\u{646}\u{634}\u{631}",
    "\u{631}\u{62f}",
    "\u{627}\u{631}\u{633}\u{627}\u{644}",
    "\u{628}\u{641}\u{631}\u{633}\u{62a}",
    "\u{627}\u{646}\u{62a}\u{634}\u{627}\u{631}",
    "\u{67e}\u{627}\u{633}\u{62e}",
    "\u{628}\u{6be}\u{6cc}\u{62c}\u{6cc}\u{6ba}",
    "\u{92d}\u{947}\u{91c}\u{947}\u{902}",
    "\u{92a}\u{94d}\u{930}\u{915}\u{93e}\u{936}\u{93f}\u{924}",
    "\u{91c}\u{935}\u{93e}\u{92c} \u{926}\u{947}\u{902}",
    "\u{92a}\u{93e}\u{920}\u{935}\u{93e}",
    "\u{9aa}\u{9be}\u{9a0}\u{9be}\u{9a8}",
    "\u{a2e}\u{acb}\u{a95}\u{ab2}\u{acb}",
    "\u{a2d}\u{a47}\u{a1c}\u{a4b}",
    "\u{b85}\u{ba9}\u{bc1}\u{baa}\u{bcd}\u{baa}\u{bc1}",
    "\u{c2a}\u{c02}\u{c2a}\u{c41}",
    "\u{c95}\u{cb3}\u{cc1}\u{cb9}\u{cbf}\u{cb8}\u{cbf}",
    "\u{d05}\u{d2f}\u{d2f}\u{d4d}\u{d15}\u{d4d}\u{d15}\u{d41}\u{d15}",
    "\u{e2a}\u{e48}\u{e07}",
    "\u{e42}\u{e1e}\u{e2a}\u{e15}\u{e4c}",
    "\u{e15}\u{e2d}\u{e1a}\u{e01}\u{e25}\u{e31}\u{e1a}",
    "\u{1015}\u{102d}\u{102f}\u{1037}",
    "g\u{1eed}i",
    "\u{111}\u{103}ng",
    "tr\u{1ea3} l\u{1edd}i",
    "\u{9001}\u{4fe1}",
    "\u{6295}\u{7a3f}",
    "\u{8fd4}\u{4fe1}",
    "\u{bcf4}\u{b0b4}\u{ae30}",
    "\u{c804}\u{c1a1}",
    "\u{ac8c}\u{c2dc}",
    "\u{b2f5}\u{c7a5}",
    "\u{53d1}\u{9001}",
    "\u{53d1}\u{5e03}",
    "\u{56de}\u{590d}",
    "\u{767c}\u{9001}",
    "\u{50b3}\u{9001}",
    "\u{767c}\u{5e03}",
    "\u{767c}\u{4f48}",
    "\u{56de}\u{8986}",
];

/// Presses that delete, in every language nib has a catalogue for.
pub const DELETING: &[&str] = &[
    "delete",
    "remove",
    "erase",
    "delete forever",
    "delete permanently",
    "l\u{f6}schen",
    "entfernen",
    "endg\u{fc}ltig l\u{f6}schen",
    "l\u{f6}sche",
    "entferne",
    "supprimer",
    "effacer",
    "eliminar",
    "borrar",
    "suprimir",
    "quitar",
    "elimina",
    "cancella",
    "rimuovi",
    "excluir",
    "apagar",
    "remover",
    "usu\u{144}",
    "skasuj",
    "wyma\u{17c}",
    "\u{443}\u{434}\u{430}\u{43b}\u{438}\u{442}\u{44c}",
    "\u{441}\u{442}\u{435}\u{440}\u{435}\u{442}\u{44c}",
    "\u{432}\u{438}\u{434}\u{430}\u{43b}\u{438}\u{442}\u{438}",
    "\u{441}\u{442}\u{435}\u{440}\u{442}\u{438}",
    "sil",
    "kald\u{131}r",
    "hapus",
    "padam",
    "buang",
    "busak",
    "tanggalin",
    "burahin",
    "futa",
    "ondoa",
    "goge",
    "cire",
    "\u{1230}\u{122d}\u{12dd}",
    "\u{62d}\u{630}\u{641}",
    "\u{627}\u{62d}\u{630}\u{641}",
    "\u{625}\u{632}\u{627}\u{644}\u{629}",
    "\u{645}\u{633}\u{62d}",
    "\u{67e}\u{627}\u{6a9} \u{6a9}\u{631}\u{62f}\u{646}",
    "\u{6c1}\u{679}\u{627}\u{626}\u{6cc}\u{6ba}",
    "\u{939}\u{91f}\u{93e}\u{90f}\u{902}",
    "\u{92e}\u{93f}\u{91f}\u{93e}\u{90f}\u{902}",
    "\u{939}\u{91f}\u{935}\u{93e}",
    "\u{9ae}\u{9c1}\u{99b}\u{9c1}\u{9a8}",
    "\u{a95}\u{abe}\u{aa2}\u{ac0} \u{aa8}\u{abe}\u{a96}\u{acb}",
    "\u{a2e}\u{a3f}\u{a1f}\u{a3e}\u{a13}",
    "\u{ba8}\u{bc0}\u{b95}\u{bcd}\u{b95}\u{bc1}",
    "\u{c24}\u{c4a}\u{c32}\u{c17}\u{c3f}\u{c02}\u{c1a}\u{c41}",
    "\u{c85}\u{cb3}\u{cbf}\u{cb8}\u{cbf}",
    "\u{d07}\u{d32}\u{d4d}\u{d32}\u{d3e}\u{d24}\u{d3e}\u{d15}\u{d4d}\u{d15}\u{d41}\u{d15}",
    "\u{e25}\u{e1a}",
    "\u{1016}\u{103b}\u{1000}\u{103a}",
    "x\u{f3}a",
    "x\u{f2}a",
    "g\u{1ee1} b\u{1ecf}",
    "\u{524a}\u{9664}",
    "\u{6d88}\u{53bb}",
    "\u{c0ad}\u{c81c}",
    "\u{c81c}\u{ac70}",
    "\u{5220}\u{9664}",
    "\u{79fb}\u{9664}",
    "\u{6e05}\u{9664}",
    "\u{522a}\u{9664}",
];

/// Payment processors, by site.
const PAYMENT_HOSTS: &[&str] = &[
    "stripe.com",
    "stripe.network",
    "paypal.com",
    "paypalobjects.com",
    "braintreegateway.com",
    "braintree-api.com",
    "adyen.com",
    "adyenpayments.com",
    "checkout.com",
    "klarna.com",
    "klarnaservices.com",
    "afterpay.com",
    "affirm.com",
    "squareup.com",
    "pay.google.com",
    "payments.google.com",
    "applepay.cdn-apple.com",
    "pay.amazon.com",
    "payments.amazon.com",
    "worldpay.com",
    "authorize.net",
    "2checkout.com",
    "mollie.com",
    "razorpay.com",
    "paddle.com",
    "paystack.co",
    "flutterwave.com",
    "payu.com",
    "mercadopago.com",
    "alipay.com",
    "twint.ch",
    "sofort.com",
    "trustly.com",
    "shop.app",
    "pay.shopify.com",
    "recurly.com",
    "chargebee.com",
    "gocardless.com",
    "sezzle.com",
    "zip.co",
    "bitpay.com",
    "commerce.coinbase.com",
    "datatrans.com",
    "saferpay.com",
    "payrexx.com",
    "wallee.com",
];

/// Mail, messaging and social sites, where a press named send is a message leaving.
const SOCIAL: &[&str] = &[
    "mail.google.com",
    "gmail.com",
    "outlook.com",
    "outlook.live.com",
    "outlook.office.com",
    "outlook.office365.com",
    "mail.yahoo.com",
    "proton.me",
    "protonmail.com",
    "icloud.com",
    "fastmail.com",
    "gmx.net",
    "gmx.de",
    "gmx.ch",
    "web.de",
    "mail.ru",
    "mail.yandex.ru",
    "tutanota.com",
    "tuta.com",
    "zoho.com",
    "x.com",
    "twitter.com",
    "facebook.com",
    "messenger.com",
    "instagram.com",
    "threads.net",
    "linkedin.com",
    "reddit.com",
    "bsky.app",
    "mastodon.social",
    "tiktok.com",
    "youtube.com",
    "discord.com",
    "slack.com",
    "teams.microsoft.com",
    "teams.live.com",
    "whatsapp.com",
    "telegram.org",
    "signal.org",
    "github.com",
    "gitlab.com",
    "medium.com",
    "substack.com",
    "tumblr.com",
    "pinterest.com",
    "quora.com",
    "stackoverflow.com",
    "stackexchange.com",
    "news.ycombinator.com",
    "weibo.com",
    "vk.com",
    "line.me",
    "wechat.com",
    "snapchat.com",
    "chat.google.com",
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::grants::Grant;

    fn grant() -> Grant {
        Grant::own("a".into(), "A")
    }

    fn press(name: &str) -> Facts {
        Facts {
            tag: "button".into(),
            name: name.into(),
            ..Facts::default()
        }
    }

    fn category(facts: &Facts, url: &str) -> Option<Category> {
        judge(&grant(), facts, Act::Press, url, &[]).map(|question| question.category)
    }

    #[test]
    fn a_site_is_its_registrable_domain() {
        assert_eq!(site_of("www.shop.example"), "shop.example");
        assert_eq!(site_of("news.bbc.co.uk"), "bbc.co.uk");
        assert_eq!(site_of("moodle-app2.let.ethz.ch"), "ethz.ch");
        assert_eq!(site_of("127.0.0.1"), "127.0.0.1");
        assert_eq!(site_of("localhost"), "localhost");
    }

    #[test]
    fn a_rule_covers_its_site_and_every_host_under_it() {
        let mut grant = grant();
        grant
            .sites
            .insert("bank.example".into(), SiteRule::AgentStore);
        grant.sites.insert("evil.example".into(), SiteRule::Deny);
        grant
            .sites
            .insert("ok.evil.example".into(), SiteRule::Allow);
        assert_eq!(
            rule_for(&grant, "login.bank.example"),
            Some(SiteRule::AgentStore)
        );
        assert_eq!(rule_for(&grant, "evil.example"), Some(SiteRule::Deny));
        assert_eq!(rule_for(&grant, "ok.evil.example"), Some(SiteRule::Allow));
        assert_eq!(rule_for(&grant, "notbank.example"), None);

        assert!(site_allowed(&grant, "https://a.evil.example/", Store::Agent).is_err());
        assert!(site_allowed(&grant, "https://bank.example/", Store::Reader).is_err());
        assert!(site_allowed(&grant, "https://bank.example/", Store::Agent).is_ok());
        assert!(site_allowed(&grant, "https://ok.evil.example/", Store::Reader).is_ok());
    }

    /// The table: a press, the page it is on, and what it asks. Several languages each.
    #[test]
    fn presses_are_recognised_in_every_language() {
        let cases: &[(&str, &str, Option<Category>)] = &[
            ("Place order", "https://shop.example/", Some(Category::Paying)),
            ("Pay \u{20ac}12.50", "https://shop.example/", Some(Category::Paying)),
            ("Jetzt kaufen", "https://shop.example/", Some(Category::Paying)),
            ("Zahlungspflichtig bestellen", "https://shop.example/", Some(Category::Paying)),
            ("Passer la commande", "https://shop.example/", Some(Category::Paying)),
            ("Finalizar compra", "https://shop.example/", Some(Category::Paying)),
            ("\u{6ce8}\u{6587}\u{3092}\u{78ba}\u{5b9a}\u{3059}\u{308b}", "https://shop.example/", Some(Category::Paying)),
            ("\u{7acb}\u{5373}\u{8d2d}\u{4e70}", "https://shop.example/", Some(Category::Paying)),
            ("\u{acb0}\u{c81c}\u{d558}\u{ae30}", "https://shop.example/", Some(Category::Paying)),
            ("\u{41e}\u{444}\u{43e}\u{440}\u{43c}\u{438}\u{442}\u{44c} \u{437}\u{430}\u{43a}\u{430}\u{437}", "https://shop.example/", Some(Category::Paying)),
            ("Send", "https://mail.google.com/mail/u/0/", Some(Category::Sending)),
            ("Senden", "https://outlook.office.com/mail/", Some(Category::Sending)),
            ("Publier", "https://www.linkedin.com/feed/", Some(Category::Sending)),
            ("\u{53d1}\u{9001}", "https://weibo.com/", Some(Category::Sending)),
            // Send on a site that is not for messages is not a message leaving.
            ("Send", "https://shop.example/contact", None),
            ("Delete", "https://drive.example/", Some(Category::Deleting)),
            ("Endg\u{fc}ltig l\u{f6}schen", "https://drive.example/", Some(Category::Deleting)),
            ("Supprimer le fichier", "https://drive.example/", Some(Category::Deleting)),
            ("\u{524a}\u{9664}", "https://drive.example/", Some(Category::Deleting)),
            ("Sil", "https://drive.example/", Some(Category::Deleting)),
            // A word inside another word is not the word.
            ("Silver plan", "https://drive.example/", None),
            ("Payment history", "https://shop.example/", None),
            ("Search", "https://shop.example/", None),
            ("Next", "https://shop.example/", None),
        ];
        for (name, url, expected) in cases {
            assert_eq!(category(&press(name), url), *expected, "{name} on {url}");
        }
    }

    #[test]
    fn a_press_in_a_form_with_a_card_field_is_paying() {
        let mut facts = press("Continue");
        facts.in_form = true;
        facts.submit = true;
        facts.fields = vec![Field {
            kind: "text".into(),
            autocomplete: "cc-number".into(),
            said: String::new(),
        }];
        assert_eq!(
            category(&facts, "https://shop.example/"),
            Some(Category::Paying)
        );
        facts.fields = vec![Field {
            kind: "text".into(),
            autocomplete: String::new(),
            said: "Kartennummer".into(),
        }];
        assert_eq!(
            category(&facts, "https://shop.example/"),
            Some(Category::Paying)
        );
    }

    #[test]
    fn a_submit_on_a_page_that_talks_to_a_payment_processor_is_paying() {
        let mut facts = press("Continue");
        facts.submit = true;
        let hosts = vec!["js.stripe.com".to_string()];
        let asked = judge(
            &grant(),
            &facts,
            Act::Press,
            "https://shop.example/",
            &hosts,
        );
        assert_eq!(asked.map(|one| one.category), Some(Category::Paying));
        facts.submit = false;
        assert!(judge(
            &grant(),
            &facts,
            Act::Press,
            "https://shop.example/",
            &hosts
        )
        .is_none());
    }

    #[test]
    fn the_summary_is_the_press_and_the_site() {
        let asked = judge(
            &grant(),
            &press("Place order"),
            Act::Press,
            "https://www.shop.example/cart",
            &[],
        )
        .expect("asks");
        assert_eq!(asked.summary, "Place order on shop.example");
    }

    #[test]
    fn a_category_turned_off_or_always_allowed_does_not_ask() {
        let mut grant = grant();
        grant.asks.insert(Category::Deleting, false);
        assert!(judge(
            &grant,
            &press("Delete"),
            Act::Press,
            "https://a.example/",
            &[]
        )
        .is_none());
        grant
            .always
            .insert("shop.example".into(), vec![Category::Paying]);
        assert!(judge(
            &grant,
            &press("Buy now"),
            Act::Press,
            "https://shop.example/",
            &[]
        )
        .is_none());
        assert!(judge(
            &grant,
            &press("Buy now"),
            Act::Press,
            "https://other.example/",
            &[]
        )
        .is_some());
    }

    #[test]
    fn confirm_mode_asks_for_every_write() {
        let mut grant = grant();
        grant.mode = Mode::Confirm;
        let asked = judge(
            &grant,
            &press("Next"),
            Act::Press,
            "https://a.example/",
            &[],
        );
        assert_eq!(asked.map(|one| one.category), Some(Category::Writing));
        let typed = judge(
            &grant,
            &Facts::default(),
            Act::Write,
            "https://a.example/",
            &[],
        );
        assert_eq!(typed.map(|one| one.category), Some(Category::Writing));
    }

    #[test]
    fn a_sign_in_form_and_a_card_field_are_known() {
        let facts = Facts {
            tag: "input".into(),
            kind: "email".into(),
            in_form: true,
            fields: vec![Field {
                kind: "password".into(),
                ..Field::default()
            }],
            ..Facts::default()
        };
        assert!(facts.sign_in());
        assert!(!facts.password());
        let card = Facts {
            tag: "input".into(),
            autocomplete: "cc-csc".into(),
            ..Facts::default()
        };
        assert!(card.sensitive());
        assert!(Facts {
            tag: "select".into(),
            ..Facts::default()
        }
        .picker());
        assert!(Facts {
            tag: "input".into(),
            kind: "date".into(),
            ..Facts::default()
        }
        .picker());
    }

    #[test]
    fn scripts_are_per_site() {
        let mut grant = grant();
        grant.scripts.push("docs.example".into());
        assert!(script_allowed(&grant, "api.docs.example"));
        assert!(!script_allowed(&grant, "shop.example"));
    }

    #[test]
    fn payment_processors_and_social_sites_are_known() {
        assert!(payment_host("js.stripe.com"));
        assert!(payment_host("www.paypal.com"));
        assert!(!payment_host("stripe.example"));
        assert!(social("mail.google.com"));
        assert!(!social("docs.google.com"));
    }
}
