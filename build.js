const fs = require('fs');
const https = require('https');
const { parseStringPromise } = require('xml2js');

const XML_URL = 'http://partner.miogest.com/agenzie/demo.xml';
const TEMPLATE_PATH = './template.html';
const OUTPUT_PATH = './index.html';

function fetchXML(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function generateCard(immobile) {
  const get = tag => immobile[tag]?.[0] || '';
  const image = immobile.foto?.[0]?.foto_url?.[0] || '';
  const title = get('titolo');
  const location = get('localita');
  const price = get('prezzo');
  const description = get('descrizione')?.substring(0, 150) + '...';

  return `
    <div class="property-card">
      <div class="property-image">
        <img src="\${image}" alt="Immagine proprietà">
      </div>
      <div class="property-details">
        <div class="property-title">\${title}</div>
        <div class="property-location">\${location}</div>
        <div class="property-price">\${price} €</div>
        <div class="property-description">\${description}</div>
      </div>
    </div>
  `;
}

(async () => {
  try {
    const xmlData = await fetchXML(XML_URL);
    const parsed = await parseStringPromise(xmlData);
    const immobili = parsed.immobili?.immobile || [];

    const cards = immobili.map(generateCard).join('\n');
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const output = template.replace('<!-- PROPERTIES_CARDS -->', cards);

    fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
    console.log('✅ index.html generato con successo!');
  } catch (err) {
    console.error('Errore:', err);
  }
})();
