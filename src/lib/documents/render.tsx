import "server-only";
import { createElement as h, type ReactElement } from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import type { DocumentModel, Section, TableSpec } from "./model";

/**
 * The one renderer every produced document goes through: an A4 page in
 * the house palette, the lessor's block, the tenant's, the date, the
 * subject, the blocks the composer laid out, the signature and a footer
 * naming the template version. Only drawing happens here; the words come
 * composed and the legal figures came from the registry.
 */
const BRAND = "#14636f";
const INK = "#1f2a30";
const SOFT = "#5b6770";
const RULE = "#d9d4c8";
const ZEBRA = "#f6f4ef";

const styles = StyleSheet.create({
  page: { paddingTop: 56, paddingBottom: 64, paddingHorizontal: 56, fontFamily: "Helvetica", fontSize: 10.5, color: INK },
  // The reading measure lives on the body, not the page: a line height set on
  // the page makes react-pdf drop the fixed footer (template version, page
  // numbers) from every page. Declared with its font size, it resolves to the
  // same 15.2 points the page used to give every line.
  body: { fontSize: 10.5, lineHeight: 1.45 },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 22 },
  party: { maxWidth: "48%" },
  partyLabel: { fontSize: 7.5, color: SOFT, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 },
  partyName: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  partyLine: { fontSize: 9.5, color: SOFT },
  meta: { marginBottom: 14, fontSize: 9.5, color: SOFT },
  title: { fontFamily: "Helvetica-Bold", fontSize: 18, color: BRAND, marginBottom: 4 },
  // A contract opens on its title, centred, as the parties' copy reads.
  contractTitle: { fontFamily: "Helvetica-Bold", fontSize: 15, color: BRAND, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  contractSubtitle: { fontSize: 10, color: SOFT, textAlign: "center", marginBottom: 18 },
  lead: { fontFamily: "Helvetica-Bold", marginTop: 6, marginBottom: 4 },
  item: { flexDirection: "row", marginBottom: 4, paddingLeft: 6 },
  bullet: { width: 12 },
  itemText: { flex: 1, textAlign: "justify" },
  subtitle: { fontSize: 10.5, color: SOFT, marginBottom: 10 },
  subject: { fontFamily: "Helvetica-Bold", marginBottom: 12 },
  heading: { fontFamily: "Helvetica-Bold", fontSize: 10, color: BRAND, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 12, marginBottom: 5 },
  paragraph: { marginBottom: 7, textAlign: "justify" },
  note: { fontSize: 8.5, color: SOFT, marginTop: 4, marginBottom: 6 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: RULE },
  kvKey: { color: SOFT, fontSize: 9.5 },
  kvValue: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  table: { marginTop: 4, marginBottom: 8 },
  tr: { flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: RULE },
  th: { fontSize: 7.5, color: SOFT, textTransform: "uppercase", letterSpacing: 0.4 },
  td: { fontSize: 9.5 },
  total: { fontFamily: "Helvetica-Bold" },
  qr: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  qrImage: { width: 96, height: 96, marginRight: 12 },
  qrCaption: { fontSize: 8.5, color: SOFT, flex: 1 },
  closing: { marginTop: 10 },
  signatures: { flexDirection: "row", justifyContent: "space-between", marginTop: 26 },
  signature: { width: "45%" },
  signatureLabel: { fontSize: 8.5, color: SOFT, marginBottom: 28 },
  signatureName: { fontFamily: "Helvetica-Bold", borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 4 },
  // Room for a provider's signature field (138 by 60 points) above each name line.
  signatureSpace: { height: 68 },
  signatureLine: { marginBottom: 14 },
  // The provider reads the anchor from the text layer, at 10 points; on paper it is invisible.
  anchor: { fontSize: 10, color: "#ffffff" },
  footer: { position: "absolute", left: 56, right: 56, bottom: 28, fontSize: 7.5, color: SOFT, flexDirection: "row", justifyContent: "space-between" },
  watermark: { position: "absolute", top: 340, left: 40, right: 40, textAlign: "center", fontSize: 34, color: "#c9c2b6", opacity: 0.5, transform: "rotate(-24deg)", fontFamily: "Helvetica-Bold" },
});

function Table({ spec }: { spec: TableSpec }): ReactElement {
  const widths = spec.columns.map((c) => c.width ?? 1);
  const sum = widths.reduce((a, b) => a + b, 0);
  const cell = (i: number, text: string, bold = false) =>
    h(Text, { key: i, style: { ...styles.td, ...(bold ? styles.total : {}), width: `${(widths[i] / sum) * 100}%`, textAlign: spec.columns[i].align ?? "left", paddingRight: 4 } }, text);
  return h(
    View,
    { style: styles.table },
    h(View, { style: styles.tr }, spec.columns.map((c, i) => h(Text, { key: i, style: { ...styles.th, width: `${(widths[i] / sum) * 100}%`, textAlign: c.align ?? "left" } }, c.label))),
    ...spec.rows.map((row, r) => h(View, { key: r, style: r % 2 === 1 ? { ...styles.tr, backgroundColor: ZEBRA } : styles.tr }, row.map((text, i) => cell(i, text)))),
    spec.total ? h(View, { style: styles.tr }, spec.total.map((text, i) => cell(i, text, true))) : null,
  );
}

function SectionView({ section, qr }: { section: Section; qr: string | null }): ReactElement {
  const [first, ...rest] = section.paragraphs ?? [];
  // A heading or a lead never ends a page alone: it travels with its first paragraph.
  const opening = section.heading || section.lead
    ? h(
        View,
        { wrap: false },
        section.heading ? h(Text, { style: styles.heading }, section.heading) : null,
        section.lead ? h(Text, { style: styles.lead }, section.lead) : null,
        first !== undefined ? h(Text, { style: styles.paragraph }, first) : null,
      )
    : first !== undefined
      ? h(Text, { style: styles.paragraph }, first)
      : null;
  return h(
    View,
    null,
    opening,
    ...rest.map((p, i) => h(Text, { key: `p${i}`, style: styles.paragraph }, p)),
    ...(section.items ?? []).map((item, i) => h(View, { key: `i${i}`, style: styles.item, wrap: false }, h(Text, { style: styles.bullet }, "\u2022"), h(Text, { style: styles.itemText }, item))),
    section.keyValues
      ? h(View, null, section.keyValues.map(([k, v], i) => h(View, { key: i, style: styles.kvRow }, h(Text, { style: styles.kvKey }, k), h(Text, { style: styles.kvValue }, v))))
      : null,
    section.table ? h(Table, { spec: section.table }) : null,
    section.note ? h(Text, { style: styles.note }, section.note) : null,
    section.qr && qr ? h(View, { style: styles.qr }, h(Image, { style: styles.qrImage, src: qr }), h(Text, { style: styles.qrCaption }, section.qr.caption)) : null,
  );
}

function Party({ label, name, lines }: { label: string; name: string; lines: string[] }): ReactElement {
  return h(View, { style: styles.party }, h(Text, { style: styles.partyLabel }, label), h(Text, { style: styles.partyName }, name), ...lines.map((l, i) => h(Text, { key: i, style: styles.partyLine }, l)));
}

async function qrImages(model: DocumentModel): Promise<Array<string | null>> {
  return Promise.all(model.sections.map((s) => (s.qr ? QRCode.toDataURL(s.qr.payload, { errorCorrectionLevel: "M", margin: 1, scale: 4 }) : Promise.resolve(null))));
}

export interface RenderLabels {
  sender: string;
  recipient: string;
  reference: string;
  subject: string;
  page: string;
}

/**
 * The signature columns. Printed for paper, each column is its label, room
 * to sign and the name. Produced for an electronic signature, every signer
 * gets their own line, with the provider's anchor drawn invisibly where
 * their signature goes.
 */
/**
 * The word an anchor follows. A line that opens with punctuation is drawn as
 * two runs ("{{" then the rest); after a word, the anchor stays one run of
 * text, as the provider's parser expects to read it.
 */
const ANCHOR_LEAD = "Signature";

function SignatureView({ signature }: { signature: NonNullable<DocumentModel["signature"]> }) {
  const anchors = signature.anchors;
  const names = signature.second?.names;
  if (!anchors && names && names.length > 1) {
    // On paper, several tenants each get room to sign above their own name.
    const line = (key: string, name: string) => h(View, { key, style: styles.signatureLine, wrap: false }, h(View, { style: styles.signatureSpace }), h(Text, { style: styles.signatureName }, name));
    return h(
      View,
      { style: styles.signatures },
      h(View, { style: styles.signature }, h(Text, { style: { ...styles.signatureLabel, marginBottom: 6 } }, signature.label), line("first", signature.name)),
      h(View, { style: styles.signature }, h(Text, { style: { ...styles.signatureLabel, marginBottom: 6 } }, signature.second!.label), ...names.map((name, i) => line(`second-${i}`, name))),
    );
  }
  if (!anchors) {
    return h(
      View,
      { style: styles.signatures },
      h(View, { style: styles.signature }, h(Text, { style: styles.signatureLabel }, signature.label), h(Text, { style: styles.signatureName }, signature.name)),
      signature.second ? h(View, { style: styles.signature }, h(Text, { style: styles.signatureLabel }, signature.second.label), h(Text, { style: styles.signatureName }, signature.second.name)) : null,
    );
  }
  const line = (key: string, name: string, anchor: string) =>
    h(View, { key, style: styles.signatureLine, wrap: false }, h(View, { style: styles.signatureSpace }, h(Text, { style: styles.anchor }, `${ANCHOR_LEAD} ${anchor}`)), h(Text, { style: styles.signatureName }, name));
  return h(
    View,
    { style: styles.signatures },
    h(View, { style: styles.signature }, h(Text, { style: { ...styles.signatureLabel, marginBottom: 6 } }, signature.label), line("first", signature.name, anchors.first)),
    signature.second
      ? h(View, { style: styles.signature }, h(Text, { style: { ...styles.signatureLabel, marginBottom: 6 } }, signature.second.label), ...anchors.second.map((s, i) => line(`second-${i}`, s.name, s.anchor)))
      : null,
  );
}

export async function renderPdf(model: DocumentModel, labels: RenderLabels): Promise<Buffer> {
  const qrs = await qrImages(model);
  // A contract opens on its title and names its parties in its own text; a letter opens on the sender, the recipient and the date.
  const opening = model.layout === "contract"
    ? [
        h(Text, { key: "title", style: styles.contractTitle }, model.title),
        model.subtitle ? h(Text, { key: "subtitle", style: styles.contractSubtitle }, model.subtitle) : null,
      ]
    : [
        h(
          View,
          { key: "head", style: styles.head },
          h(Party, { label: labels.sender, name: model.sender.name, lines: model.sender.lines }),
          model.recipient ? h(Party, { label: labels.recipient, name: model.recipient.name, lines: model.recipient.lines }) : null,
        ),
        h(Text, { key: "meta", style: styles.meta }, model.dateLine + (model.reference ? `   ·   ${labels.reference} ${model.reference}` : "")),
        h(Text, { key: "title", style: styles.title }, model.title),
        model.subtitle ? h(Text, { key: "subtitle", style: styles.subtitle }, model.subtitle) : null,
      ];
  const doc = h(
    Document,
    { title: model.title, author: model.sender.name, subject: model.subject ?? model.title, creator: "Morada Gestion", producer: "Morada Gestion" },
    h(
      Page,
      { size: "A4", style: styles.page },
      model.watermark ? h(Text, { style: styles.watermark, fixed: true }, model.watermark) : null,
      h(
        View,
        { style: styles.body },
        ...opening,
        model.subject ? h(Text, { style: styles.subject }, `${labels.subject} : ${model.subject}`) : null,
        ...model.sections.map((section, i) => h(SectionView, { key: i, section, qr: qrs[i] })),
        // The closing and the signatures stay on one page: nobody signs under a page of their own.
        h(
          View,
          { wrap: false },
          model.closing && model.closing.length > 0 ? h(View, { style: styles.closing }, ...model.closing.map((c, i) => h(Text, { key: i, style: styles.paragraph }, c))) : null,
          model.signature ? h(SignatureView, { signature: model.signature }) : null,
        ),
      ),
      h(
        View,
        { style: styles.footer, fixed: true },
        h(Text, { style: { flex: 1, paddingRight: 12 } }, model.footer),
        // Drawn after layout, the page count has no width of its own: it gets one, so the footer text stops short of it.
        h(Text, { style: { width: 56, textAlign: "right" }, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `${labels.page} ${pageNumber}/${totalPages}` }),
      ),
    ),
  );
  return renderToBuffer(doc);
}
