const fs = require('fs');
const http = require('http');
const { parseStringPromise } = require('xml2js');

const XML_URL = 'http://partner.miogest.com/agenzie/demo.xml';
const TEMPLATE_PATH = './template.html';
const OUTPUT_PATH = './index.html';
const DEFAULT_DETAIL_LINK = 'https://www.luxuryacademy.online/';

function fetchXML(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function generateCard(annuncio) {
  const get = (tag) => annuncio[tag]?.[0] || '';
  const foto = annuncio.Foto?.[0] || '';
  const descrizione = get('Descrizione');
  const descrizioneShort = descrizione.length > 150 ? descrizione.substring(0, 150) + '...' : descrizione;

  return `
    <div class="property-card">
      <div class="property-image">
        <img src="${foto}" alt="Immagine proprietà">
      </div>
      <div class="property-details">
        <div class="property-title">${get('Titolo')}</div>
        <div class="property-location">${get('Comune')}</div>
        <div class="property-price">${get('Prezzo')} €</div>
        <div class="property-description">${descrizioneShort}</div>
        <a class="view-button" href="${DEFAULT_DETAIL_LINK}" target="_blank">Vedi dettagli</a>
      </div>
    </div>
  `;
}

(async () => {
  try {
    const xmlData = await fetchXML(XML_URL);
    const parsed = await parseStringPromise(xmlData);
    const annunci = parsed.Annunci?.Annuncio || [];

    if (!annunci.length) {
      console.log('⚠️ Nessun annuncio trovato nel feed XML.');
    }

    const cardsHtml = annunci.map(generateCard).join('\n');
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const output = template.replace('<div class="properties-grid">', '<div class="properties-grid">' + cardsHtml);

    fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
    console.log('✅ index.html generato con successo!');
  } catch (err) {
    console.error('❌ Errore durante la generazione:', err);
  }
})();
