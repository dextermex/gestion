/**
 * Les modèles français des documents que l'application produit.
 *
 * Règles de rédaction (voir docs/ARCHITECTURE.md, « Trace papier ») :
 *   - chaque modèle est explicite, écrit pour cette langue, jamais traduit
 *     automatiquement d'une autre ;
 *   - chaque chiffre à portée juridique (délai, plafond, taux) est un
 *     paramètre légal de src/domain/legal/params.ts, injecté au moment de
 *     la composition avec son statut (vérifié / incertain), jamais écrit en
 *     dur ici ;
 *   - un modèle ne produit un document qu'une fois validé par l'espace, dans
 *     cette version ; changer le texte d'un modèle change sa `version` et
 *     redemande la validation ;
 *   - `notes` dit au relecteur ce qu'il valide et ce que le modèle ne fait
 *     pas (aucune clause générale, aucun délai non paramétré).
 *
 * Les valeurs entre accolades sont remplies par le composeur.
 */
import type { DocumentKind } from "../kinds";

export interface KindWording {
  version: string;
  title: string;
  subject?: string;
  /** Column headings, sentence fragments and alternatives the composer picks from. */
  labels: Record<string, string>;
  paragraphs: string[];
  closing: string[];
  signatureLabel: string;
  notes: string;
  /** The legal parameters the wording relies on, by registry key. */
  legalParams: string[];
}

export interface Wording {
  lang: "fr";
  common: {
    dateLine: string;
    referenceLabel: string;
    subjectLabel: string;
    senderLabel: string;
    recipientLabel: string;
    footer: string;
    pageLabel: string;
    previewWatermark: string;
    tenantsJoin: string;
    yes: string;
    no: string;
    amountColumns: { period: string; dueDate: string; billed: string; open: string };
    paymentBlock: { heading: string; iban: string; bic: string; holder: string; reference: string; qrCaption: string };
    regimes: Record<string, string>;
    depositForms: Record<string, string>;
    leaseTypes: Record<string, string>;
    chargeCategories: Record<string, string>;
    capitalKinds: Record<string, string>;
    edlKinds: Record<string, string>;
    edlCategories: Record<string, string>;
    edlConditions: Record<string, string>;
    deductionKinds: Record<string, string>;
    deductionStatuses: Record<string, string>;
    paramStatus: { verified: string; uncertain: string };
  };
  kinds: Record<DocumentKind, KindWording>;
}

export const fr: Wording = {
  lang: "fr",
  common: {
    dateLine: "{city}, le {date}",
    referenceLabel: "Référence",
    subjectLabel: "Objet",
    senderLabel: "Bailleur",
    recipientLabel: "Locataire",
    footer: "Document produit par Morada Gestion pour {lessor}. Modèle {kind} v{version} ({lang}). Empreinte et date de production conservées au registre des documents.",
    pageLabel: "Page",
    previewWatermark: "MODÈLE : VALEURS FICTIVES",
    tenantsJoin: " et ",
    yes: "oui",
    no: "non",
    amountColumns: { period: "Période", dueDate: "Échéance", billed: "Montant", open: "Reste dû" },
    paymentBlock: {
      heading: "Coordonnées de paiement",
      iban: "IBAN",
      bic: "BIC",
      holder: "Titulaire du compte",
      reference: "Communication structurée",
      qrCaption: "Code QR de virement (EPC) : à scanner dans votre application bancaire, les coordonnées, le montant et la communication sont préremplis.",
    },
    regimes: { advances: "provisions sur charges avec décompte annuel", forfait: "forfait de charges", none: "sans charges" },
    depositForms: { cash: "versement sur un compte bloqué", bank_guarantee: "garantie bancaire", third_party_caution: "caution d'un tiers", insurance: "garantie par assurance", state_guarantee: "garantie de l'État", none: "aucune garantie" },
    leaseTypes: { residential: "Contrat de bail à usage d'habitation", commercial: "Contrat de bail commercial" },
    chargeCategories: {
      heating: "Chauffage",
      water: "Eau",
      electricity_common: "Électricité des communs",
      cleaning: "Nettoyage",
      elevator: "Ascenseur",
      waste: "Déchets",
      insurance_building: "Assurance de l'immeuble",
      syndic_fees: "Honoraires du syndic",
      repairs: "Réparations",
      caretaker: "Concierge",
      garden: "Espaces verts",
      other: "Autre",
    },
    capitalKinds: { land: "terrain", construction: "construction", improvement: "amélioration" },
    edlKinds: { entry: "État des lieux d'entrée", intermediate: "État des lieux intermédiaire", exit: "État des lieux de sortie" },
    edlCategories: {
      paint: "Peintures",
      floors: "Sols",
      interior_joinery: "Menuiseries intérieures",
      exterior_joinery: "Menuiseries extérieures",
      tiling: "Carrelages",
      plumbing: "Plomberie",
      electrics: "Électricité",
      heating: "Chauffage",
      gas: "Gaz",
      appliances: "Équipements",
      keys: "Clés",
      meters: "Compteurs",
      other: "Autre",
    },
    edlConditions: { new: "neuf", good: "bon état", fair: "état d'usage", poor: "mauvais état", damaged: "endommagé" },
    deductionKinds: { arrears: "Arriérés de loyer", damage: "Dégâts locatifs", charge_reserve: "Réserve pour charges" },
    deductionStatuses: { justified: "justifiée", pending: "justificatif attendu", expired_forfeited: "forclose (non justifiée dans le délai)", blocked_no_entry_edl: "sans effet (pas d'état des lieux d'entrée)" },
    paramStatus: { verified: "vérifié", uncertain: "à confirmer" },
  },
  kinds: {
    rent_notice: {
      version: "2026-09-26.1",
      labels: {
        rent: "Loyer",
        charges: "Charges",
        other: "Autre",
        vat: "TVA",
        total: "Total",
        paid: "Déjà reçu",
        remaining: "Reste à payer",
        breakdownLine: "Détail : {items}.",
        paidLine: "Déjà reçu : {paid}. Reste à payer : {remaining}.",
      },
      title: "Avis d'échéance",
      subject: "Loyer et charges de {period}",
      paragraphs: [
        "Le loyer et les charges du logement {unit} pour {period} s'élèvent à {total}, payables au plus tard le {dueDate}.",
        "{breakdown}",
        "{paid}",
      ],
      closing: ["Nous vous remercions de votre règlement."],
      signatureLabel: "Le bailleur",
      notes: "Document d'information : rappelle le montant du mois, sa décomposition, la date d'échéance et les coordonnées de paiement. Aucune clause. Le code QR reprend l'IBAN, le titulaire et la communication structurée du bail.",
      legalParams: [],
    },
    rent_receipt: {
      version: "2026-09-26.1",
      labels: {
        paidOn: "Payé le",
        amount: "Montant",
        paymentsLine: "Paiement(s) reçu(s) : {items}.",
        paymentItem: "{amount} le {date}",
      },
      title: "Quittance de loyer",
      subject: "Loyer et charges de {period}",
      paragraphs: [
        "Le bailleur soussigné déclare avoir reçu de {tenants} la somme de {total} au titre du loyer et des charges du logement {unit} pour {period}.",
        "{payments}",
        "La présente quittance porte sur la période indiquée et ne préjuge pas des sommes qui resteraient dues pour d'autres périodes.",
      ],
      closing: [],
      signatureLabel: "Le bailleur",
      notes: "Délivrée seulement pour une période entièrement payée, d'après les allocations du grand livre. La dernière phrase réserve les autres périodes : à valider ou à retirer.",
      legalParams: [],
    },
    arrears_formal: {
      version: "2026-09-26.1",
      labels: {
        statement: "Relevé des périodes ouvertes",
      },
      title: "Relance formelle",
      subject: "Loyer et charges de {period} impayés",
      paragraphs: [
        "Sauf erreur ou omission de notre part, le loyer et les charges du logement {unit} pour {period}, d'un montant de {total} échu le {dueDate}, restent impayés à ce jour à hauteur de {open}.",
        "Nous vous remercions de régulariser cette somme dans les meilleurs délais, sur le compte indiqué ci-dessous et avec la communication structurée du bail.",
        "Si votre paiement s'est croisé avec ce courrier, nous vous prions de ne pas tenir compte de la présente.",
      ],
      closing: ["Nous restons à votre disposition pour toute question sur ce relevé."],
      signatureLabel: "Le bailleur",
      notes: "Deuxième échelon de l'échelle des impayés (J+10, src/domain/arrears/ladder.ts). Relevé des périodes ouvertes joint. Aucun délai ni aucune conséquence juridique n'est énoncé à ce stade.",
      legalParams: [],
    },
    arrears_mise_en_demeure: {
      version: "2026-09-26.1",
      labels: {
        statement: "Relevé des périodes ouvertes",
        remindersBoth: "Malgré nos rappels du {friendly} et du {formal}, ",
        remindersOne: "Malgré notre rappel du {date}, ",
      },
      title: "Mise en demeure",
      subject: "Loyer et charges de {period} impayés : mise en demeure",
      paragraphs: [
        "{reminders}",
        "Le loyer et les charges du logement {unit} pour {period}, d'un montant de {total} échu le {dueDate}, restent impayés à hauteur de {open}.",
        "Par la présente, adressée par lettre recommandée avec accusé de réception, nous vous mettons en demeure de régler cette somme sans délai sur le compte indiqué ci-dessous, avec la communication structurée du bail.",
        "À défaut de règlement, nous nous réservons le droit d'engager les démarches que la loi met à notre disposition pour le recouvrement des sommes dues et, le cas échéant, la résiliation du bail, sans autre avis.",
      ],
      closing: [],
      signatureLabel: "Le bailleur",
      notes: "Troisième échelon (J+24). Envoyée par LRAR : l'effet juridique court de la date de l'accusé de réception, enregistrée à part. Le modèle ne fixe pas de délai chiffré (aucun paramètre légal ne le porte) : « sans délai » et la réserve des voies de droit sont à valider par le bailleur ou son conseil. Aucune coupure de service n'est jamais évoquée.",
      legalParams: [],
    },
    indexation_notice: {
      version: "2026-09-26.1",
      labels: {
        constraintCeiling: "Le nouveau loyer est fixé au plafond légal.",
        constraintStep: "Le nouveau loyer est fixé au palier maximal d'un ajustement.",
        constraintNone: "",
      },
      title: "Notice d'ajustement du loyer",
      subject: "Ajustement du loyer du logement {unit}",
      paragraphs: [
        "Conformément à la loi modifiée du 21 septembre 2006 sur le bail à usage d'habitation, nous vous informons de l'ajustement du loyer du logement {unit}.",
        "Loyer mensuel actuel : {current}. Nouveau loyer mensuel : {proposed}.",
        "Le nouveau loyer s'applique à compter du premier jour du mois qui suit la réception de la présente (date de l'accusé de réception).",
        "Motivation : le loyer est plafonné à {ceilingPct} % par an du capital investi dans le logement, soit {ceilingMonthly} par mois ({ceilingStatus}) ; chaque ajustement est limité à {stepPct} % ({stepStatus}) et ne peut intervenir moins de {intervalMonths} mois après le précédent ou le début du bail ({intervalStatus}). {constraint}",
        "Le calcul détaillé (capital investi, réévaluation, décote de vétusté) est conservé par le bailleur et peut vous être communiqué sur demande.",
      ],
      closing: ["Nous restons à votre disposition pour toute question sur cet ajustement."],
      signatureLabel: "Le bailleur",
      notes: "Les trois chiffres viennent du registre des paramètres légaux (residential.rent_ceiling_pct_of_capital, residential.rent_adjustment_max_step_pct, residential.rent_adjustment_min_interval_months) avec leur statut. Le modèle ne décrit pas la voie de contestation : à ajouter et valider si le bailleur le souhaite.",
      legalParams: ["residential.rent_ceiling_pct_of_capital", "residential.rent_adjustment_max_step_pct", "residential.rent_adjustment_min_interval_months"],
    },
    charges_statement: {
      version: "2026-09-26.1",
      labels: {
        label: "Poste",
        category: "Catégorie",
        buildingTotal: "Total immeuble",
        tantiemes: "Tantièmes",
        lotShare: "Part du lot",
        tenantShare: "Part locataire",
        blockedMark: "non récupérable",
        blockedNote: "Postes non récupérables en bail d'habitation : {amount}, restant à la charge du bailleur.",
        balanceOwed: "Charges réelles récupérables : {actual}. Provisions facturées : {advances}. Solde à votre charge : {balance}{due}.",
        balanceRefund: "Charges réelles récupérables : {actual}. Provisions facturées : {advances}. Solde en votre faveur : {balance}, à restituer par le bailleur.",
        balanceZero: "Charges réelles récupérables : {actual}. Provisions facturées : {advances}. Solde nul.",
        dueOn: ", à régler pour le {date}",
        actual: "Charges réelles",
        advances: "Provisions facturées",
        balance: "Solde",
      },
      title: "Décompte des charges {year}",
      subject: "Décompte des charges de l'année {year} pour le logement {unit}",
      paragraphs: [
        "Le présent décompte est établi selon le régime prévu au bail ({regime}). Il récapitule les charges de l'année {year} et les provisions facturées sur la même période.",
        "{blocked}",
        "{balance}",
      ],
      closing: ["Les justificatifs des postes ci-dessus sont tenus à votre disposition."],
      signatureLabel: "Le bailleur",
      notes: "Postes calculés par le moteur de refacturation (part du lot par tantièmes ou telle que saisie, part locataire nulle pour les postes non récupérables en bail d'habitation). Le solde est la différence entre les charges réelles récupérables et les provisions facturées.",
      legalParams: [],
    },
    deposit_settlement: {
      version: "2026-09-26.1",
      labels: {
        received: ", reçue le {date}",
        decompteIssued: "Décompte des charges émis le {date}.",
        decomptePending: "Décompte des charges non encore émis : le solde de la garantie sera exigible dans les {months} mois de son émission ({status}).",
        kind: "Nature",
        label: "Libellé",
        amount: "Montant",
        status: "Statut",
        retained: "Retenu",
        deadline: "Justification avant le",
        totalRetained: "Total retenu : {amount}.",
        noRetention: "Aucune retenue.",
        firstTrancheRule: "{months} mois après la remise des clés, {status}",
        balanceRule: "{months} mois après l'émission du décompte, {status}",
        balanceDue: ", exigible le {date}",
        penalty: "Pénalité courue après mise en demeure : {months} mois × {pct} % du loyer mensuel, soit {amount} ({status}).",
        justificationRule: "Chaque retenue doit être justifiée par une facture ou un devis dans les {months} mois ({status}) ; à défaut elle est forclose.",
      },
      title: "Décompte de la garantie locative",
      subject: "Restitution de la garantie locative du logement {unit}",
      paragraphs: [
        "Garantie constituée : {deposit} ({form}){received}. Clés restituées le {keys}.",
        "{decompte}",
        "{retentions}",
        "Première tranche : {firstTranche}, exigible le {firstTrancheDue} ({firstTrancheRule}). Solde : {balance}{balanceDue} ({balanceRule}).",
        "Déjà restitué : {released}. Reste dû au locataire à la date du présent décompte : {outstanding}.",
        "{penalty}",
      ],
      closing: ["Chaque retenue renvoie à la pièce qui la justifie, conservée au registre des documents."],
      signatureLabel: "Le bailleur",
      notes: "Montants et dates calculés par le moteur de restitution (src/domain/deposits/settlement.ts) sur les lignes enregistrées. Les délais (première tranche, solde, justification, pénalité) sont des paramètres légaux imprimés avec leur statut ; residential.deposit_first_tranche_months_after_keys est marqué « à confirmer » dans le registre.",
      legalParams: [
        "residential.deposit_first_tranche_months_after_keys",
        "residential.deposit_balance_months_after_decompte",
        "residential.deposit_justification_window_months",
        "residential.deposit_penalty_pct_of_monthly_rent_per_month",
      ],
    },
    lease_contract: {
      version: "2026-09-26.1",
      labels: {
        designation: "Désignation : {unit}, {address}{details}.",
        floor: "étage {floor}",
        area: "{area} m²",
        rooms: "{rooms} pièces",
        bedrooms: "{bedrooms} chambres",
        furnished: "meublé",
        energy: "classe énergétique {energy}",
        cadastral: "cadastre {cadastral}",
        durationFixed: "Durée : le bail prend effet le {start} et prend fin le {end}.",
        durationOpen: "Durée : le bail prend effet le {start}, pour une durée indéterminée.",
        rent: "Loyer : {rent} par mois{charges}{supplement}, payable le {day} de chaque mois{reference}{account}.",
        chargesAdvances: ", plus {charges} par mois de provisions sur charges avec décompte annuel",
        chargesForfait: ", plus {charges} par mois de forfait de charges",
        chargesNone: ", charges non applicables",
        supplement: ", plus {supplement} par mois de supplément pour le mobilier",
        reference: ", avec la communication structurée {rf}",
        account: ", sur le compte {iban} au nom de {holder}",
        deposit: "Garantie locative : {months} mois de loyer, soit {amount}, sous forme de {form} (maximum légal : {max} mois, {status}).",
        capitalList: "Déclaration du capital investi : {list} (total {total}).",
        capitalItem: "{kind} {year} : {amount}",
        capitalNone: "Aucune déclaration de capital investi n'est jointe au présent contrat.",
        colocation: "Colocation : plusieurs preneurs ; le pacte de colocation est joint en annexe.",
        tenantSignature: "Le(s) preneur(s)",
      },
      title: "{leaseType}",
      paragraphs: [
        "Entre le bailleur, {lessor}, et le(s) preneur(s), {tenants}, il est convenu ce qui suit.",
        "{designation}",
        "{duration}",
        "{rent}",
        "{deposit}",
        "{capital}",
        "{colocation}",
        "Les conditions particulières et les annexes éventuelles (inventaire du mobilier, pacte de colocation, règlement de l'immeuble) sont jointes par le bailleur et signées par les parties.",
      ],
      closing: ["Fait en autant d'exemplaires que de parties, chacune reconnaissant avoir reçu le sien."],
      signatureLabel: "Le bailleur",
      notes: "Le modèle reprend les mentions que le dossier de location a validées (parties, désignation, date de début, durée, loyer, régime des charges, garantie, déclaration du capital investi). Il ne contient aucune clause générale : les conditions particulières restent à joindre par le bailleur. Signature manuscrite ou électronique hors application.",
      legalParams: ["residential.deposit_max_months"],
    },
    housing_certificate: {
      version: "2026-09-26.1",
      labels: {
        end: " et prenant fin le {end}",
      },
      title: "Attestation de logement",
      paragraphs: [
        "Je soussigné(e) {signatory}, agissant pour le compte du bailleur {lessor}, atteste que {tenants} occupe(nt) en qualité de locataire(s) le logement {unit}, sis {address}, en vertu d'un bail à usage d'habitation prenant effet le {start}{end}.",
        "La présente attestation est délivrée à la demande de l'intéressé(e) pour servir et valoir ce que de droit, notamment en vue de la déclaration d'arrivée auprès de l'administration communale, à effectuer dans les {communeDays} jours suivant l'emménagement ({communeStatus}).",
      ],
      closing: [],
      signatureLabel: "Pour le bailleur",
      notes: "Attestation factuelle : occupant, logement, adresse, date d'effet du bail. Le délai de déclaration communale vient du registre des paramètres (compliance.commune_arrival_declaration_days) avec son statut.",
      legalParams: ["compliance.commune_arrival_declaration_days"],
    },
    edl_report: {
      version: "2026-09-26.1",
      labels: {
        keysEntry: "remises au locataire le {date}",
        keysExit: "restituées au bailleur le {date}",
        keysNone: "non remises à ce jour",
        signed: "Signé contradictoirement par les parties.",
        unsigned: "Non signé à ce jour.",
        summary: "{items} postes relevés dans {rooms} pièce(s), {photos} photo(s) jointe(s), {readings} relevé(s) de compteur.",
        category: "Poste",
        condition: "État",
        notes: "Observations",
        photos: "Photos",
        meter: "Compteur",
        value: "Relevé",
        readOn: "Le",
        photoRoom: "Pièce",
        capturedAt: "Prise le",
        sha256: "Empreinte SHA-256",
        readingsHeading: "Relevés de compteurs",
        photosHeading: "Photos jointes",
      },
      title: "{edlKind}",
      subject: "Logement {unit}",
      paragraphs: [
        "État des lieux établi le {date} entre le bailleur, {lessor}, et le(s) locataire(s), {tenants}. Clés {keys}. {signed}",
        "{summary}",
      ],
      closing: [
        "Empreinte SHA-256 du manifeste (postes, photos, dates) : {manifest}. Toute modification ultérieure des postes ou des photos changerait cette empreinte.",
      ],
      signatureLabel: "Le bailleur",
      notes: "Rapport factuel des postes relevés pièce par pièce, des relevés de compteurs et de la liste des photos avec leur empreinte. Le scellement calcule l'empreinte du manifeste ; les photos elles-mêmes restent au registre.",
      legalParams: [],
    },
  },
};
