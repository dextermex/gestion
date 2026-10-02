/**
 * Le contrat de bail à usage d'habitation, en français.
 *
 * Le texte des articles 1 à 15, des parties et des signatures est celui du
 * modèle remis par le bailleur le 2 octobre 2026, repris mot pour mot. Les
 * blancs du modèle sont des valeurs entre accolades que le composeur remplit
 * depuis l'espace ; chaque chiffre légal (préavis, plafond, palier, garantie,
 * délais de restitution, pénalité, déclaration communale) vient du registre
 * des paramètres légaux, jamais d'ici.
 *
 * `variants` réunit les seules phrases que le modèle ne contenait pas : une
 * société comme partie, la civilité neutre, la maison ou un autre logement,
 * la durée indéterminée, le logement meublé, le forfait ou l'absence de
 * charges, les autres formes de garantie, l'absence de garantie, et la
 * destination quand le locataire est une société. Elles sont citées dans
 * les notes du modèle pour que la validation porte aussi sur elles.
 */
import type { ContractWording } from "./fr";

const UNITS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

/** A whole number from 0 to 99 in French words, traditional spelling ("vingt et un", "quatre-vingts"). */
export function frenchCardinal(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 20) return UNITS[n];
  if (n < 70) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (u === 0) return TENS[t];
    return u === 1 ? `${TENS[t]} et un` : `${TENS[t]}-${UNITS[u]}`;
  }
  if (n < 80) return n === 71 ? "soixante et onze" : `soixante-${UNITS[n - 60]}`;
  if (n === 80) return "quatre-vingts";
  return `quatre-vingt-${UNITS[n - 80]}`;
}

/**
 * French spacing, bound: the space before a colon, a semicolon, a question
 * or exclamation mark, a percent sign and inside guillemets never breaks a
 * line, so no line of the contract starts with ":" or "»". Only spaces change.
 */
export function frenchSpacing(text: string): string {
  return text.replace(/ ([:;?!%»])/g, "\u00a0$1").replace(/« /g, "«\u00a0");
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** "1er octobre 2026", "15 mars 1985": the date as a contract writes it. */
export function frenchLongDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const day = Number(m[3]);
  return `${day === 1 ? "1er" : day} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export const frResidentialContract: ContractWording = {
  typeset: frenchSpacing,
  heading: "Contrat de bail à usage d'habitation",
  subheading: "(loi modifiée du 21 septembre 2006 sur le bail à usage d'habitation)",
  between: "ENTRE LES SOUSSIGNÉS :",
  lessorLead: "Le Bailleur :",
  tenantLead: "Le Locataire :",
  lessorRole: "ci-après dénommé(s) « le Bailleur », d'une part,",
  tenantRole: "ci-après dénommé(s) « le Locataire », d'autre part,",
  natural: {
    lessor: "{person}, {born} le {birthDate} à {birthPlace}, de nationalité {nationality}, demeurant {address}.",
    tenant: "{person}, {born} le {birthDate} à {birthPlace}, de nationalité {nationality}, demeurant actuellement {address}.",
  },
  civility: {
    m: { title: "Monsieur", born: "né" },
    f: { title: "Madame", born: "née" },
    x: { title: "", born: "né(e)" },
  },
  preamble: [
    "Lorsque plusieurs personnes signent le présent contrat en qualité de Locataire, elles sont tenues solidairement et indivisiblement de l'ensemble des obligations qui en résultent, chacune pouvant être poursuivie pour la totalité des sommes dues.",
    "Le Bailleur et le Locataire sont ci-après désignés ensemble « les Parties ». La loi modifiée du 21 septembre 2006 sur le bail à usage d'habitation et modifiant certaines dispositions du Code civil est ci-après désignée « la Loi ».",
  ],
  agreed: "IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT :",
  articles: [
    {
      heading: "1. OBJET DU BAIL",
      paragraphs: [
        "Le Bailleur donne en location au Locataire, qui accepte, {dwelling} {premisesAddress}, Grand-Duché de Luxembourg (ci-après « le Logement »).",
        "Référence cadastrale : {cadastral}.",
        "Le Logement comprend les pièces et parties d'immeuble suivantes : {premises}.",
        "{furnished}",
        "{copropriete}",
        "Le Bailleur remet au Locataire, au plus tard à la signature du présent contrat, une copie du certificat de performance énergétique (CPE) en cours de validité.",
        "Le Bailleur déclare que le Logement répond aux critères minimaux de salubrité, d'hygiène, de sécurité et d'habitabilité prévus par la réglementation en vigueur et qu'il est équipé de détecteurs autonomes de fumée conformes à la législation applicable.",
      ],
    },
    {
      heading: "2. DESTINATION DES LIEUX",
      paragraphs: [
        "{destination}",
        "Toute utilisation du Logement à des fins professionnelles, commerciales, artisanales ou d'hébergement contre rémunération, y compris la location de courte durée, est interdite sans l'accord écrit et préalable du Bailleur.",
        "{communeDeclaration}",
      ],
    },
    {
      heading: "3. DURÉE",
      paragraphs: [
        "{duration}",
        "Conformément à l'article 12 (2) de la Loi, tout bail qui vient à cesser pour quelque cause que ce soit est prorogé à durée indéterminée, à moins que le Bailleur ne se prévale de l'un des motifs limitativement prévus par la Loi : besoin personnel du Bailleur ou d'un parent ou allié jusqu'au troisième degré inclusivement, inexécution par le Locataire de ses obligations, ou autres motifs graves et légitimes à établir par le Bailleur. Le transfert de propriété du Logement ne constitue pas un motif grave et légitime.",
      ],
    },
    {
      heading: "4. RÉSILIATION ET RESTITUTION DES LIEUX",
      paragraphs: [
        "Résiliation par le Locataire. Le Locataire peut résilier le bail moyennant un préavis de {tenantNotice}, notifié au Bailleur par lettre recommandée avec avis de réception. Le préavis prend cours à la date de réception de la lettre recommandée.",
        "{fixedTermNotice}",
        "Résiliation par le Bailleur. Le Bailleur ne peut résilier le bail ni s'opposer à sa prorogation que dans les cas prévus à l'article 12 (2) de la Loi. En cas de besoin personnel, le délai de résiliation est de {personalNeedNotice} ; la lettre de résiliation doit être écrite, motivée, accompagnée le cas échéant des pièces afférentes, notifiée par lettre recommandée avec avis de réception et reproduire, sous peine de nullité, le texte de l'article 12 (3) de la Loi. Dans les autres cas, le délai de résiliation est de {landlordNotice}, sans préjudice de la résiliation judiciaire en cas d'inexécution grave des obligations du Locataire.",
        "À l'expiration du bail, le Locataire restitue le Logement libre de toute occupation et de tout meuble lui appartenant, remet l'intégralité des clés au Bailleur ou à son mandataire, en mains propres contre reçu ou par lettre recommandée avec avis de réception, et communique sa nouvelle adresse.",
      ],
    },
    {
      heading: "5. LOYER",
      paragraphs: [
        "Le loyer mensuel, hors charges, est fixé à {rent}.",
        "{furnitureSupplement}",
        "Le loyer est payable mensuellement et par anticipation, au plus tard le {paymentDay} de chaque mois, par virement bancaire (ordre permanent), sur le compte bancaire suivant :",
        "IBAN : {iban} – Banque : {bank} – Titulaire du compte : {holder}",
        "Le premier loyer est payable au plus tard le jour de la prise d'effet du bail. Le paiement est réputé effectué à la date à laquelle le compte du Bailleur est crédité. Le Bailleur délivre quittance sur demande.",
        "Plafond légal. Le Bailleur déclare que le loyer respecte le plafond fixé par l'article 3 de la Loi, selon lequel la location d'un logement à usage d'habitation ne peut rapporter au bailleur un revenu annuel dépassant {ceilingPct} % du capital investi dans le logement, réévalué et, le cas échéant, décoté conformément à la Loi.",
        "Adaptation du loyer. Le loyer et, le cas échéant, le supplément de loyer pour le mobilier ne peuvent être adaptés que {adjustmentInterval}, dans les limites de l'article 3 de la Loi ; chaque hausse ne peut dépasser {adjustmentStepPct} %. Toute adaptation est notifiée par écrit. Aucune clause d'indexation automatique n'est applicable (article 5 (5) de la Loi).",
        "Commission des loyers. Conformément à l'article 5 (1), point 8°, de la Loi, les Parties sont informées qu'elles ont la possibilité de saisir la commission des loyers compétente, conformément à l'article 8 de la Loi, en cas de litige sur la fixation du loyer.",
      ],
    },
    {
      heading: "6. CHARGES ET SERVICES",
      paragraphs: [
        "{chargesAmount}",
        "{chargesStatement}",
        "Ne peuvent être mis à charge du Locataire que les frais exposés pour la consommation d'énergie, l'entretien courant du Logement et des parties communes, les menues réparations ainsi que les taxes liées à l'usage du Logement, et uniquement les montants que le Bailleur justifie avoir déboursés pour le compte du Locataire (article 5 (3) de la Loi). Les charges communes à plusieurs logements sont réparties selon les quotes-parts de la copropriété ou, à défaut, selon un mode de répartition à convenir entre les Parties.",
        "Les contrats de fourniture d'électricité, de gaz, d'eau, de télécommunications et de tout autre service non compris dans les charges éventuellement perçues par le Bailleur sont souscrits par le Locataire à son nom et à ses frais.",
      ],
    },
    {
      heading: "7. GARANTIE LOCATIVE",
      paragraphs: [
        "Pour garantir le paiement du loyer et des charges ainsi que l'exécution de toutes les obligations découlant du bail, le Locataire constitue, au plus tard le jour de la remise des clés, une garantie locative de {deposit}, montant qui n'excède pas {depositMax} de loyer hors charges (article 5 (2) de la Loi), sous la forme suivante : {depositForm}.",
        "Le Bailleur ne peut refuser, même après la conclusion du bail, une garantie locative sous forme de garantie bancaire. La garantie ne peut être imputée par le Locataire sur les loyers ou charges en cours de bail.",
        "Restitution. Lorsque, à la fin du bail, l'état des lieux de sortie est conforme à l'état des lieux d'entrée, sauf usure et vétusté normales, et que le Bailleur n'a pas de revendication en matière d'arriérés de loyer ou de dégâts locatifs, {firstTrancheShare} de la garantie est restituée dans un délai maximal {firstTrancheDelay} à partir de la remise des clés. Le solde, déduction faite des sommes restant dues au Bailleur et dûment justifiées par pièces, est restitué au plus tard {balanceDelay} soit la réception des décomptes de charges, que le Bailleur demande aux services et administrations concernés au plus tard {decompteRequestDelay} après la fin du bail, soit l'approbation définitive des comptes annuels de l'immeuble par l'assemblée générale des copropriétaires (article 5 (2bis) de la Loi).",
        "À défaut de restitution dans les délais et à partir d'une mise en demeure adressée par lettre recommandée avec avis de réception, la partie de la garantie restant due est majorée d'une somme égale à {penaltyPct} % du loyer mensuel pour chaque période mensuelle commencée de retard, sauf si le retard est imputable au Locataire. En cas de transfert de propriété du Logement, la garantie est transférée de plein droit au nouveau propriétaire.",
      ],
    },
    {
      heading: "8. ÉTAT DES LIEUX",
      paragraphs: [
        "Un état des lieux d'entrée écrit et contradictoire, décrivant l'état du Logement, de ses équipements et, le cas échéant, du mobilier, ainsi que les relevés des compteurs, est établi et signé par les Parties au plus tard le jour de l'entrée en jouissance du Logement par le Locataire. Il est annexé au présent contrat.",
        "Un état des lieux de sortie contradictoire est établi lors de la restitution des clés, à une date convenue entre les Parties. Le Locataire répond des dégradations et pertes survenues pendant le bail, à l'exception de celles résultant de l'usure ou de la vétusté normales, de la force majeure ou du fait du Bailleur. Si les Parties font appel à un expert pour l'établissement des états des lieux, ses frais sont partagés par moitié, sauf accord contraire.",
      ],
    },
    {
      heading: "9. OBLIGATIONS DU LOCATAIRE",
      paragraphs: ["Le Locataire s'oblige à :"],
      items: [
        "payer le loyer et les charges aux échéances convenues ;",
        "user du Logement en bon père de famille et conformément à la destination prévue au présent contrat (article 1728 du Code civil) ;",
        "assurer l'entretien courant du Logement et de ses équipements ainsi que les réparations locatives et de menu entretien (article 1754 du Code civil), notamment l'entretien annuel des installations de chauffage et de production d'eau chaude, le ramonage, le remplacement des joints, ampoules et petites pièces d'usure, ainsi que l'entretien et le remplacement des piles des détecteurs de fumée ;",
        "signaler sans délai au Bailleur, par écrit, tout sinistre, dégradation ou défaut affectant le Logement et nécessitant une intervention du Bailleur ;",
        "laisser le Bailleur ou son mandataire accéder au Logement, sur rendez-vous pris au moins quarante-huit heures à l'avance sauf urgence, pour en vérifier l'état et y exécuter les travaux nécessaires, et, en cas de congé ou de mise en vente, le faire visiter à raison de deux jours par semaine, deux heures par jour, aux heures convenues ;",
        "respecter le règlement d'ordre intérieur de l'immeuble et, le cas échéant, le règlement de copropriété, ainsi que la tranquillité du voisinage ;",
        "n'effectuer aucuns travaux de transformation, de modification des installations ou de changement des serrures sans l'accord écrit préalable du Bailleur ; les aménagements autorisés restent acquis au Bailleur en fin de bail sans indemnité, sauf accord contraire, à moins que celui-ci n'exige la remise en état ;",
        "ne détenir aucun animal domestique dans le Logement ;",
        "ne pas céder le présent bail ni sous-louer le Logement, en tout ou en partie, même à titre gratuit, sans l'accord écrit préalable du Bailleur ; conformément à l'article 2 de la Loi, la cession du bail est expressément interdite sans cet accord ;",
        "ne pas entreposer de matières dangereuses ou insalubres et respecter les prescriptions de sécurité et d'hygiène applicables ;",
        "restituer le Logement en bon état d'entretien et de propreté à la fin du bail, à l'exception de l'usure et de la vétusté normales.",
      ],
    },
    {
      heading: "10. OBLIGATIONS DU BAILLEUR",
      paragraphs: ["Le Bailleur s'oblige à :"],
      items: [
        "délivrer le Logement en bon état de réparations de toute espèce, muni de ses équipements en bon état de fonctionnement, et en assurer la jouissance paisible pendant toute la durée du bail (articles 1719 et 1720 du Code civil) ;",
        "effectuer toutes les réparations autres que locatives, notamment les grosses réparations et celles dues à la vétusté, à un vice de construction ou à la force majeure, et entretenir le Logement en état de servir à l'usage prévu ;",
        "{cpeHandover}",
        "délivrer quittance des sommes versées, établir les décomptes de charges et communiquer sur demande les pièces justificatives ;",
        "restituer la garantie locative dans les délais et conditions prévus à l'article « Garantie locative » ;",
        "informer le Locataire par écrit de tout changement de propriétaire ou de mandataire ainsi que de toute modification des coordonnées de paiement.",
      ],
    },
    {
      heading: "11. ASSURANCES",
      paragraphs: [
        "Le Locataire souscrit, avant l'entrée en jouissance et pour toute la durée du bail, auprès d'une compagnie d'assurance agréée au Grand-Duché de Luxembourg, une assurance couvrant sa responsabilité civile locative (incendie, explosion, dégâts des eaux, bris de vitres, recours des voisins et des tiers) ainsi que son mobilier. Il en justifie au Bailleur par la remise d'une attestation avant la remise des clés, puis à chaque échéance annuelle sur simple demande.",
        "Le Bailleur assure l'immeuble et le Logement en sa qualité de propriétaire. Le Locataire ne peut prétendre à aucune indemnité en cas d'interruption temporaire des services collectifs (eau, électricité, chauffage, ascenseur) due à une cause étrangère au Bailleur.",
      ],
    },
    {
      heading: "12. FRAIS D'AGENCE",
      paragraphs: [
        "Aucun agent immobilier ni autre tiers n'est intervenu dans la conclusion de la présente location ; aucun frais d'intermédiation n'est dû. Conformément à l'article 5 (1) de la Loi, la conclusion du bail n'est liée au paiement d'aucune somme autre que le loyer.",
      ],
    },
    {
      heading: "13. RETARD DE PAIEMENT ET INEXÉCUTION",
      paragraphs: [
        "Toute somme due en vertu du présent contrat et non payée à son échéance porte intérêt au taux légal à compter d'une mise en demeure adressée par lettre recommandée avec avis de réception, sans préjudice des frais de recouvrement justifiés.",
        "En cas de non-paiement du loyer ou des charges, ou de toute autre inexécution par le Locataire de ses obligations non régularisée dans les quinze jours d'une mise en demeure, le Bailleur peut demander au juge de paix la résiliation du bail et le déguerpissement du Locataire, l'inexécution de ses obligations par le Locataire constituant un motif s'opposant à la prorogation du bail au sens de l'article 12 (2), point b, de la Loi.",
      ],
    },
    {
      heading: "14. DISPOSITIONS DIVERSES",
      paragraphs: [
        "Nullité partielle. Toute stipulation du présent contrat destinée à priver d'effet une disposition de la Loi est nulle de plein droit (article 5 (5) de la Loi), sans que la validité des autres clauses en soit affectée.",
        "Notifications. Toute notification relative au présent bail, et notamment tout congé, est faite par lettre recommandée avec avis de réception à l'adresse de la Partie destinataire. Pour l'exécution des présentes, le Bailleur élit domicile à l'adresse indiquée ci-dessus et le Locataire dans le Logement.",
        "Enregistrement. L'enregistrement du présent bail auprès de l'Administration de l'enregistrement, des domaines et de la TVA n'est pas obligatoire ; il peut être requis par l'une des Parties, à ses frais, afin de conférer date certaine au contrat.",
        "Transfert de propriété. En cas d'aliénation du Logement, le présent bail est opposable à l'acquéreur dans les conditions de l'article 1743 du Code civil et de l'article 12 (5) et (6) de la Loi.",
        "Langue et exemplaires. Le présent contrat est rédigé en langue française. Il est établi en autant d'exemplaires originaux que de Parties, chacune reconnaissant avoir reçu le sien.",
        "Annexes. Font partie intégrante du présent contrat :",
      ],
      items: [
        "l'état des lieux d'entrée ;",
        "{inventoryAnnex}",
        "la copie du certificat de performance énergétique (CPE) ;",
        "{coproprieteAnnex}",
        "l'attestation d'assurance du Locataire.",
      ],
    },
    {
      heading: "15. DROIT APPLICABLE ET LITIGES",
      paragraphs: [
        "Le présent contrat est soumis au droit luxembourgeois, et notamment à la Loi ainsi qu'aux articles 1713 à 1762-2 du Code civil.",
        "Les litiges relatifs à la fixation ou à l'adaptation du loyer peuvent être portés devant la commission des loyers compétente dans les conditions des articles 7 à 10 de la Loi. Tous les autres litiges relatifs au présent bail relèvent de la compétence du juge de paix du lieu de situation du Logement (article 19 de la Loi).",
      ],
    },
  ],
  /** How the figures read in words, by their value: the registry gives the number, the language its phrase. */
  figures: {
    monthsWithDigits: "{words} ({n}) mois",
    months: "{words} mois",
    everyYear: "chaque année",
    everyYears: "tous les {words} ans",
    everyMonths: "tous les {words} mois",
    half: "la moitié",
    share: "{pct} %",
    withinOneMonth: "d'un mois",
    withinMonths: "de {words} mois",
    followingMonth: "dans le mois qui suit",
    followingMonths: "dans les {words} mois qui suivent",
    oneMonth: "un mois",
    days: "{words}",
    cadastral: "commune de {commune}, section {section}, numéro {number}",
    floor: "étage {floor}",
    area: "{area}\u00a0m²",
    room: "{n} pièce",
    rooms: "{n} pièces",
    bedroom: "{n} chambre",
    bedrooms: "{n} chambres",
  },
  madeAt: "Fait à Luxembourg, le {date}, en autant d'exemplaires originaux que de Parties.",
  handwritten: "Signatures précédées de la mention manuscrite « Lu et approuvé ».",
  signatureLessor: "Le Bailleur",
  signatureTenant: "Le Locataire",
  /** What the template already said, for the alternatives the composer picks. */
  fixed: {
    dwellingApartment: "un appartement situé",
    unfurnished: "Le Logement est loué non meublé.",
    copropriete:
      "Le Logement fait partie d'un immeuble soumis au statut de la copropriété. Sur demande du Locataire, le Bailleur lui communique une copie des extraits du règlement de copropriété concernant la destination de l'immeuble, la jouissance et l'usage des parties privatives et communes, ainsi que la quote-part du lot loué dans chaque catégorie de charges (article 5 (3) de la Loi).",
    destination: "Le Logement est destiné exclusivement à l'habitation du Locataire et des membres de son ménage, à titre de résidence principale.",
    communeDeclaration: "Le Locataire s'engage à déclarer son arrivée auprès de l'administration communale du lieu de situation du Logement dans les {communeDays} jours de son emménagement et à y déclarer son départ à la fin du bail.",
    durationFixed: "Le présent bail est conclu pour une durée déterminée prenant effet le {start} et venant à échéance le {end}.",
    fixedTermNotice: "Pendant la durée déterminée initiale, le congé donné par le Locataire ne peut prendre effet qu'à la date d'échéance fixée à l'article « Durée » ; toute résiliation anticipée requiert l'accord écrit du Bailleur, sous réserve de la clause de sortie anticipée éventuellement stipulée ci-dessous.",
    chargesAdvances: "Le Locataire verse en sus du loyer, aux mêmes échéances, un acompte mensuel sur charges de {charges}.",
    chargesStatement: "Le Bailleur établit chaque année un décompte détaillé des charges, accompagné sur demande des pièces justificatives. La différence entre les acomptes versés et les frais réellement exposés est réglée par la Partie débitrice dans le mois de la remise du décompte. Les acomptes peuvent être adaptés aux frais réellement exposés pour le compte du Locataire au cours des exercices antérieurs (article 5 (3) de la Loi).",
    depositBankGuarantee: "garantie bancaire à première demande émise par un établissement de crédit établi au Luxembourg",
    cpeHandover: "remettre au Locataire une copie du certificat de performance énergétique en cours de validité et, sur demande, les extraits pertinents du règlement de copropriété ;",
    coproprieteAnnex: "les extraits du règlement de copropriété et, le cas échéant, le règlement d'ordre intérieur de l'immeuble ;",
    firstDay: "1er",
  },
  /** Written for Morada, not in the template: each one is quoted in the notes and validated with it. */
  variants: {
    legal: "{name}, {legalForm}, établie et ayant son siège social à {seat}, immatriculée au Registre de commerce et des sociétés de Luxembourg sous le numéro {rcs}, représentée par {representative}, agissant en qualité de {role}.",
    legalNoForm: "{name}, établie et ayant son siège social à {seat}, immatriculée au Registre de commerce et des sociétés de Luxembourg sous le numéro {rcs}, représentée par {representative}, agissant en qualité de {role}.",
    signatoryLegal: "{name}, représentée par {representative}",
    dwellingHouse: "une maison située",
    dwellingOther: "un logement situé",
    furnished: "Le Logement est loué meublé ; l'inventaire du mobilier, signé par les Parties, est annexé au présent contrat.",
    furnitureSupplement: "Le supplément de loyer pour le mobilier est fixé à {supplement} par mois.",
    inventoryAnnex: "l'inventaire du mobilier ;",
    cpeHandoverNoCopropriete: "remettre au Locataire une copie du certificat de performance énergétique en cours de validité ;",
    destinationCompany:
      "Le Logement est destiné exclusivement à l'habitation, à titre de résidence principale, de la personne physique que le Locataire y loge et des membres de son ménage ; le Locataire communique l'identité de cette personne au Bailleur avant l'entrée dans les lieux.",
    communeDeclarationCompany:
      "Le Locataire veille à ce que l'occupant déclare son arrivée auprès de l'administration communale du lieu de situation du Logement dans les {communeDays} jours de son emménagement et y déclare son départ à la fin du bail.",
    durationOpen: "Le présent bail est conclu pour une durée indéterminée prenant effet le {start}.",
    chargesForfait: "Le Locataire verse en sus du loyer, aux mêmes échéances, un forfait mensuel de charges de {charges}.",
    chargesNone: "Aucun acompte sur charges n'est perçu en sus du loyer.",
    depositCash: "dépôt d'une somme d'argent sur un compte bancaire bloqué ouvert au nom du Locataire",
    depositThirdParty: "cautionnement solidaire d'un tiers, constaté par un acte séparé annexé au présent contrat",
    depositInsurance: "garantie délivrée par une entreprise d'assurances",
    depositState: "garantie accordée par l'État au titre de l'aide au financement d'une garantie locative",
    noDeposit: "Aucune garantie locative n'est exigée du Locataire.",
  },
  legalForms: {
    sarl: "société à responsabilité limitée",
    sarls: "société à responsabilité limitée simplifiée",
    sa: "société anonyme",
    sci: "société civile immobilière",
    sc: "société civile",
    senc: "société en nom collectif",
    scs: "société en commandite simple",
    scsp: "société en commandite spéciale",
    sca: "société en commandite par actions",
    scoop: "société coopérative",
    asbl: "association sans but lucratif",
    fondation: "fondation",
    other: "",
  },
  countries: { BE: "Belgique", DE: "Allemagne", FR: "France", NL: "Pays-Bas", PT: "Portugal", IT: "Italie", ES: "Espagne", CH: "Suisse", AT: "Autriche", PL: "Pologne", RO: "Roumanie", GR: "Grèce", IE: "Irlande", GB: "Royaume-Uni", US: "États-Unis" },
};
