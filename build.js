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

function convertToPropertyData(annuncio) {
  const get = (tag) => annuncio[tag]?.[0] || '';
  return {
    title: get('Titolo'),
    location: get('Comune'),
    category: get('Categoria'),
    contract: get('Contratto'),
    price: get('Prezzo'),
    image: annuncio.Foto?.[0] || '',
    description: get('Descrizione'),
    link: DEFAULT_DETAIL_LINK
  };
}

function generateCard(p) {
  const descrizioneShort = p.description.length > 150 ? p.description.substring(0, 150) + '...' : p.description;
  return `
    <div class="property-card">
      <div class="property-image">
        <img src="${p.image}" alt="Immagine proprietà">
      </div>
      <div class="property-details">
        <div class="property-title">${p.title}</div>
        <div class="property-location">${p.location}</div>
        <div class="property-price">${p.price} €</div>
        <div class="property-description">${descrizioneShort}</div>
        <a class="view-button" href="${p.link}" target="_blank">Vedi dettagli</a>
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

    const data = annunci.map(convertToPropertyData);
    const cardsHtml = data.map(generateCard).join('\n');
    const propertiesDataScript = `<script>let propertiesData = ${JSON.stringify(data)};</script>`;

    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const output = template
      .replace('<!-- PROPERTIES_CARDS -->', cardsHtml)
      .replace('<!-- PROPERTIES_DATA -->', propertiesDataScript);

    fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
    console.log('✅ index.html generato con successo!');
  } catch (err) {
    console.error('❌ Errore durante la generazione:', err);
  }
})();
