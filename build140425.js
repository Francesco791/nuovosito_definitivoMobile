const fs = require('fs');
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');
const { parseStringPromise } = require('xml2js');

// ==========================================
// CONFIGURAZIONE E COSTANTI
// ==========================================

const CONFIG = {
  XML_URL: "http://partner.miogest.com/agenzie/vella.xml",
  TEMPLATE_PATH: './template.html',
  OUTPUT_PATH: './index.html',
  LAST_BUILD_FILE: './last-build.json',
  
  // Timing e limiti
  BUILD_COOLDOWN: 5 * 60 * 1000, // 5 minuti tra build
  XML_TIMEOUT: 15000, // 15 secondi timeout
  MAX_RETRIES: 3, // Massimo 3 tentativi
  RETRY_DELAY: 2000, // 2 secondi tra retry
  
  // Configurazione Git
  GIT_USER_NAME: "github-actions[bot]",
  GIT_USER_EMAIL: "github-actions[bot]@users.noreply.github.com"
};

// ==========================================
// SISTEMA DI CONTROLLO BUILD
// ==========================================

class BuildController {
  constructor() {
    this.startTime = Date.now();
    this.stats = {
      xmlFetchTime: 0,
      parseTime: 0,
      generateTime: 0,
      totalTime: 0
    };
  }

  // Controlla se dobbiamo saltare il build per cooldown
  shouldSkipBuild() {
    try {
      if (!fs.existsSync(CONFIG.LAST_BUILD_FILE)) {
        console.log('🆕 Primo build, procedo...');
        return false;
      }

      const lastBuild = JSON.parse(fs.readFileSync(CONFIG.LAST_BUILD_FILE, 'utf8'));
      const timeSinceLastBuild = Date.now() - lastBuild.timestamp;
      
      if (timeSinceLastBuild < CONFIG.BUILD_COOLDOWN) {
        const remainingTime = Math.round((CONFIG.BUILD_COOLDOWN - timeSinceLastBuild) / 1000);
        console.log(`⏭️ Build saltato: ultimo build ${Math.round(timeSinceLastBuild/1000)}s fa`);
        console.log(`⏰ Prossimo build tra: ${remainingTime}s`);
        return true;
      }

      console.log(`✅ Cooldown superato: ${Math.round(timeSinceLastBuild/1000)}s dall'ultimo build`);
      return false;
    } catch (error) {
      console.log('⚠️ Errore controllo ultimo build:', error.message);
      return false; // In caso di errore, procedi con il build
    }
  }

  // Aggiorna informazioni ultimo build
  updateLastBuild(success = true, additionalData = {}) {
    try {
      const buildInfo = {
        timestamp: Date.now(),
        success: success,
        date: new Date().toISOString(),
        stats: this.stats,
        version: '2.0',
        ...additionalData
      };
      
      fs.writeFileSync(CONFIG.LAST_BUILD_FILE, JSON.stringify(buildInfo, null, 2));
      console.log(`💾 Informazioni build salvate (success: ${success})`);
    } catch (error) {
      console.log('⚠️ Errore salvataggio build info:', error.message);
    }
  }

  // Controlla se il contenuto è realmente cambiato
  hasContentChanged(newContent) {
    try {
      if (!fs.existsSync(CONFIG.OUTPUT_PATH)) {
        console.log('🆕 File output non esiste, contenuto sicuramente cambiato');
        return true;
      }
      
      const oldContent = fs.readFileSync(CONFIG.OUTPUT_PATH, 'utf8');
      
      // Estrai solo la sezione delle properties per confronto
      const extractPropertySection = (content) => {
        const startMarker = '<div class="properties-grid">';
        const endMarker = '</div>';
        const start = content.indexOf(startMarker);
        if (start === -1) return content;
        
        const end = content.indexOf(endMarker, start + startMarker.length);
        if (end === -1) return content;
        
        return content.substring(start, end + endMarker.length);
      };
      
      const oldPropertySection = extractPropertySection(oldContent);
      const newPropertySection = extractPropertySection(newContent);
      
      const isChanged = oldPropertySection !== newPropertySection;
      
      if (isChanged) {
        console.log('✨ Contenuto modificato, build necessario');
      } else {
        console.log('📋 Contenuto identico, build non necessario');
      }
      
      return isChanged;
    } catch (error) {
      console.log('⚠️ Errore confronto contenuto:', error.message);
      return true; // In caso di errore, assume che sia cambiato
    }
  }

  // Calcola statistiche finali
  finalizeStats() {
    this.stats.totalTime = Date.now() - this.startTime;
    console.log('\n📊 === STATISTICHE BUILD ===');
    console.log(`⏱️ XML Fetch: ${this.stats.xmlFetchTime}ms`);
    console.log(`⏱️ Parse: ${this.stats.parseTime}ms`);
    console.log(`⏱️ Generate: ${this.stats.generateTime}ms`);
    console.log(`⏱️ Totale: ${this.stats.totalTime}ms`);
  }
}

// ==========================================
// GESTIONE FETCH XML CON RETRY
// ==========================================

class XMLFetcher {
  static async fetchWithRetry(url, retries = CONFIG.MAX_RETRIES) {
    const startTime = Date.now();
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`📡 Tentativo ${attempt}/${retries}: scarico XML...`);
        const data = await this.fetchXML(url);
        const fetchTime = Date.now() - startTime;
        console.log(`✅ XML scaricato con successo in ${fetchTime}ms (${data.length} caratteri)`);
        return { data, fetchTime };
      } catch (error) {
        console.log(`❌ Tentativo ${attempt} fallito:`, error.message);
        
        if (attempt === retries) {
          throw new Error(`Impossibile scaricare XML dopo ${retries} tentativi: ${error.message}`);
        }
        
        // Aspetta prima del prossimo tentativo (backoff esponenziale)
        const delay = CONFIG.RETRY_DELAY * attempt;
        console.log(`⏳ Attendo ${delay}ms prima del prossimo tentativo...`);
        await this.sleep(delay);
      }
    }
  }

  static fetchXML(url) {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith('https');
      const httpModule = isHttps ? https : http;
      
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/xml, text/xml, */*',
          'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache, no-store',
          'Pragma': 'no-cache'
        },
        timeout: CONFIG.XML_TIMEOUT
      };

      const req = httpModule.get(url, options, (res) => {
        // Gestisci redirect
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          console.log(`🔄 Redirect a: ${res.headers.location}`);
          return this.fetchXML(res.headers.location).then(resolve).catch(reject);
        }
        
        if (res.statusCode !== 200) {
          const error = new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`);
          error.statusCode = res.statusCode;
          reject(error);
          return;
        }

        let data = '';
        let chunks = 0;
        
        res.on('data', chunk => {
          data += chunk;
          chunks++;
        });
        
        res.on('end', () => {
          console.log(`📦 Dati ricevuti: ${chunks} chunks, ${data.length} caratteri totali`);
          resolve(data);
        });
      });

      req.on('error', reject);
      
      req.setTimeout(CONFIG.XML_TIMEOUT, () => {
        req.destroy();
        reject(new Error(`Timeout dopo ${CONFIG.XML_TIMEOUT}ms`));
      });
    });
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ==========================================
// PROCESSORI DATI IMMOBILIARI
// ==========================================

class PropertyProcessor {
  // Estrai caratteristiche dall'annuncio
  static estraiCaratteristiche(annuncio) {
    const get = (tag) => annuncio[tag]?.[0] || '';
    const caratteristiche = [];
    
    const titolo = get('Titolo').toLowerCase();
    const descrizione = get('Descrizione').toLowerCase();
    const panorama = get('Scheda_Panorama').toLowerCase();
    const giardino = get('Scheda_Giardino').toLowerCase();
    const terrazzi = get('Scheda_Terrazzi').toLowerCase();
    
    // Dati numerici
    const mqGiardino = parseInt(get('MqGiardino')) || 0;
    const mqTerrazzo = parseInt(get('MqTerrazzo')) || 0;
    const postiAuto = parseInt(get('PostiAuto')) || 0;

    // Controlli caratteristiche
    const hasVista = titolo.includes('vista') || 
                     descrizione.includes('vista') || 
                     panorama.includes('vista') ||
                     panorama.includes('lago') ||
                     panorama.includes('aperta');

    const hasAttico = titolo.includes('attico') || descrizione.includes('attico');

    const hasGiardino = giardino === 'privato' || 
                        mqGiardino > 0 || 
                        descrizione.includes('giardino');

    const hasTerrazzo = mqTerrazzo > 0 || 
                        terrazzi !== 'no' ||
                        descrizione.includes('terrazzo');

    const hasBox = postiAuto > 0 || 
                   descrizione.includes('garage') || 
                   descrizione.includes('box');

    // Aggiungi caratteristiche
    if (hasVista) caratteristiche.push('vista');
    if (hasAttico) caratteristiche.push('attico');
    if (hasGiardino) caratteristiche.push('giardino');
    if (hasTerrazzo) caratteristiche.push('terrazzo');
    if (hasBox) caratteristiche.push('box');

    return caratteristiche.join(',');
  }

  // Estrai link dalle LandingPages
  static estraiLinkLandingPage(annuncio, index) {
    const get = (tag) => annuncio[tag]?.[0] || '';
    
    // Debug per primo annuncio
    if (index === 0) {
      const landingPages = annuncio.LandingPages?.[0];
      console.log('🔍 Analisi LandingPages primo annuncio:', {
        type: typeof landingPages,
        content: JSON.stringify(landingPages, null, 2)
      });
    }
    
    let link = '';
    
    // Prova estrazione da LandingPages
    const landingPages = annuncio.LandingPages?.[0];
    if (landingPages && typeof landingPages === 'object') {
      // Struttura con campo '_'
      if (landingPages.Url && Array.isArray(landingPages.Url) && landingPages.Url[0]) {
        const urlObj = landingPages.Url[0];
        if (typeof urlObj === 'object' && urlObj._) {
          link = urlObj._;
        } else if (typeof urlObj === 'string') {
          link = urlObj;
        }
      }
      
      // Prova campo Link
      if (!link && landingPages.Link && Array.isArray(landingPages.Link) && landingPages.Link[0]) {
        const linkObj = landingPages.Link[0];
        if (typeof linkObj === 'object' && linkObj._) {
          link = linkObj._;
        } else if (typeof linkObj === 'string') {
          link = linkObj;
        }
      }
    }
    
    // Fallback su campi standard
    if (!link) {
      link = get('Url') || get('Link') || get('UrlAnnuncio') || '';
    }
    
    // Ultimo fallback: genera link
    if (!link) {
      const codice = get('Codice');
      const annuncioId = get('AnnuncioId');
      
      if (codice) {
        link = `https://porpoise-helicon-zwed.squarespace.com/proprieta?codice=${codice}`;
      } else if (annuncioId) {
        link = `https://porpoise-helicon-zwed.squarespace.com/proprieta?id=${annuncioId}`;
      } else {
        link = 'https://porpoise-helicon-zwed.squarespace.com/proprieta';
      }
    }
    
    return link;
  }

  // Determina tipologia immobile
  static determinaTipologia(annuncio) {
    const get = (tag) => annuncio[tag]?.[0] || '';
    const titolo = get('Titolo').toLowerCase();
    const tipologia = get('Tipologia').toLowerCase();
    
    // Controlli basati sul titolo
    if (titolo.includes('attico')) return 'appartamento';
    if (titolo.includes('appartamento')) return 'appartamento';
    if (titolo.includes('villa') || titolo.includes('casa')) return 'casa';
    if (titolo.includes('ufficio') || titolo.includes('commerciale')) return 'commerciale';
    
    // Controlli basati su tipologia XML
    switch (tipologia) {
      case 'v': return 'casa'; // Villa
      case 'a': return 'appartamento'; // Appartamento
      case 'u': return 'commerciale'; // Ufficio
      default: return 'appartamento'; // Fallback
    }
  }

  // Genera HTML card per un immobile
  static generateCard(annuncio, index) {
    const get = (tag) => annuncio[tag]?.[0] || '';
    
    // Estrai dati base
    const foto = get('Foto') || 'https://via.placeholder.com/400x250/6E5C4F/ffffff?text=Immagine+non+disponibile';
    const titolo = get('Titolo') || 'Immobile senza titolo';
    const comune = get('Comune') || 'Località non specificata';
    const regione = get('Regione') || '';
    const provincia = get('Provincia') || '';
    const prezzo = get('Prezzo') || '0';
    const valuta = get('Valuta') || 'CHF';
    const descrizione = get('Descrizione') || 'Descrizione non disponibile';
    const contratto = (get('Offerta') === 'si' ? 'vendita' : 'affitto').toLowerCase();
    
    // Dati tecnici
    const mq = get('Mq') || '0';
    const vani = get('Vani') || '0';
    const camere = get('Camere') || '0';
    const bagni = get('Bagni') || '0';
    const categoria = get('Categoria') || '';
    
    // Processa dati
    const linkAnnuncio = this.estraiLinkLandingPage(annuncio, index);
    const tipologiaImmobile = this.determinaTipologia(annuncio);
    const caratteristiche = this.estraiCaratteristiche(annuncio);
    
    // Formattazione
    const prezzoNum = parseInt(prezzo) || 0;
    const prezzoFormattato = prezzoNum > 0 
      ? `${valuta} ${prezzoNum.toLocaleString('it-CH')}` 
      : 'Prezzo su richiesta';

    const descrizioneShort = descrizione.length > 150
      ? descrizione.substring(0, 150) + '...'
      : descrizione;

    // Log progresso
    if (index % 5 === 0 || index < 3) {
      console.log(`✅ Card ${index + 1}: "${titolo.substring(0, 30)}..." - ${comune} - ${prezzoFormattato}`);
    }

    return `
    <div class="property-card" 
         data-contratto="${contratto}"
         data-categoria="${tipologiaImmobile}"
         data-categoria-codici="${categoria}"
         data-caratteristiche="${caratteristiche}"
         data-comune="${comune.toLowerCase()}"
         data-regione="${regione.toLowerCase()}"
         data-provincia="${provincia.toLowerCase()}"
         data-prezzo="${prezzo}"
         data-mq="${mq}"
         data-vani="${vani}"
         data-camere="${camere}"
         data-bagni="${bagni}">
      <div class="property-image">
        <img src="${foto}" alt="${titolo}" onerror="this.src='https://via.placeholder.com/400x250/6E5C4F/ffffff?text=Immagine+non+disponibile'">
      </div>
      <div class="property-details">
        <div class="property-title">${titolo}</div>
        <div class="property-location">${comune}${regione ? ', ' + regione : ''}</div>
        <div class="property-price">${prezzoFormattato}</div>
        <div class="property-specs">${mq} m² • ${vani} vani • ${camere} camere • ${bagni} bagni</div>
        <div class="property-description">${descrizioneShort}</div>
        <div class="property-buttons">
          <a class="view-button" href="${linkAnnuncio}" target="_blank">
            Vedi Dettagli
          </a>
          <a class="contact-button" href="https://porpoise-helicon-zwed.squarespace.com/proprieta#block-dd726c7158bbd7fc543f" target="_blank">
            Contattaci
          </a>
        </div>
      </div>
    </div>
  `;
  }
}

// ==========================================
// GESTIONE GIT
// ==========================================

class GitManager {
  static setupGitConfig() {
    try {
      execSync(`git config user.name "${CONFIG.GIT_USER_NAME}"`);
      execSync(`git config user.email "${CONFIG.GIT_USER_EMAIL}"`);
      console.log('⚙️ Configurazione Git impostata');
    } catch (error) {
      console.log('⚠️ Errore configurazione Git:', error.message);
    }
  }

  static checkForChanges() {
    try {
      execSync('git add index.html last-build.json');
      execSync('git diff --cached --quiet');
      return false; // Nessuna modifica
    } catch {
      return true; // Ci sono modifiche
    }
  }

  static commitAndPush(annunciCount) {
    try {
      const timestamp = new Date().toLocaleString('it-IT', {
        timeZone: 'Europe/Rome',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      const commitMessage = `🔄 Aggiornamento automatico: ${annunciCount} immobili (${timestamp})`;
      
      console.log('📝 Committo le modifiche...');
      execSync(`git commit -m "${commitMessage}"`);
      
      console.log('🚀 Eseguo push...');
      execSync('git push');
      
      console.log('✅ Push completato con successo!');
      return true;
    } catch (error) {
      console.log('❌ Errore Git:', error.message);
      return false;
    }
  }
}

// ==========================================
// FUNZIONE PRINCIPALE
// ==========================================

async function main() {
  const buildController = new BuildController();
  
  try {
    console.log('🏠 === AGGIORNAMENTO IMMOBILI AVVIATO ===');
    console.log(`📅 ${new Date().toLocaleString('it-IT')}`);
    
    // Controlla cooldown
    if (buildController.shouldSkipBuild()) {
      process.exit(0);
    }

    // Scarica XML
    console.log('\n📡 === FASE 1: DOWNLOAD XML ===');
    const xmlStartTime = Date.now();
    const { data: xmlData, fetchTime } = await XMLFetcher.fetchWithRetry(CONFIG.XML_URL);
    buildController.stats.xmlFetchTime = fetchTime;

    // Parsing XML
    console.log('\n📦 === FASE 2: PARSING DATI ===');
    const parseStartTime = Date.now();
    const parsed = await parseStringPromise(xmlData);
    const annunci = parsed.Annunci?.Annuncio || [];
    buildController.stats.parseTime = Date.now() - parseStartTime;

    console.log(`🧱 Trovati ${annunci.length} annunci nel feed`);

    if (!annunci.length) {
      console.log('⚠️ ATTENZIONE: Nessun annuncio trovato nel feed XML');
      buildController.updateLastBuild(false, { error: 'no_properties_found' });
      process.exit(1);
    }

    // Genera cards
    console.log('\n🏗️ === FASE 3: GENERAZIONE CARDS ===');
    const generateStartTime = Date.now();
    const cardsHtml = annunci.map((annuncio, index) => 
      PropertyProcessor.generateCard(annuncio, index)
    ).filter(Boolean).join('\n');
    buildController.stats.generateTime = Date.now() - generateStartTime;

    console.log(`✅ Generati ${annunci.length} immobili`);

    // Carica template e genera output
    console.log('\n🧩 === FASE 4: ASSEMBLAGGIO FINALE ===');
    if (!fs.existsSync(CONFIG.TEMPLATE_PATH)) {
      throw new Error(`Template non trovato: ${CONFIG.TEMPLATE_PATH}`);
    }

    const template = fs.readFileSync(CONFIG.TEMPLATE_PATH, 'utf8');
    const output = template.replace('<!-- PROPERTIES_CARDS -->', cardsHtml);

    // Controlla se il contenuto è cambiato
    if (!buildController.hasContentChanged(output)) {
      console.log('📋 Contenuto identico all\'ultimo build, skip commit');
      buildController.updateLastBuild(true, { 
        reason: 'no_changes',
        properties_count: annunci.length 
      });
      buildController.finalizeStats();
      process.exit(0);
    }

    // Salva file
    fs.writeFileSync(CONFIG.OUTPUT_PATH, output, 'utf8');
    console.log('✅ File index.html generato con successo!');

    // Statistiche immobili
    const tipi = {};
    annunci.forEach(annuncio => {
      const tipo = PropertyProcessor.determinaTipologia(annuncio);
      tipi[tipo] = (tipi[tipo] || 0) + 1;
    });
    
    console.log('\n📊 === STATISTICHE IMMOBILI ===');
    Object.entries(tipi).forEach(([tipo, count]) => {
      console.log(`  📍 ${tipo}: ${count} immobili`);
    });

    // Git operations
    console.log('\n🔁 === FASE 5: COMMIT E PUSH ===');
    GitManager.setupGitConfig();

    if (!GitManager.checkForChanges()) {
      console.log('🟢 Nessuna modifica rilevata da Git');
      buildController.updateLastBuild(true, { 
        reason: 'git_no_changes',
        properties_count: annunci.length 
      });
    } else {
      const pushSuccess = GitManager.commitAndPush(annunci.length);
      buildController.updateLastBuild(pushSuccess, { 
        properties_count: annunci.length,
        git_push: pushSuccess
      });
    }

    // Finalizza
    buildController.finalizeStats();
    console.log('\n🎉 === BUILD COMPLETATO CON SUCCESSO ===');

  } catch (error) {
    console.error('\n❌ === ERRORE DURANTE IL BUILD ===');
    console.error('🔥 Errore:', error.message);
    console.error('📍 Stack:', error.stack);
    
    buildController.updateLastBuild(false, { 
      error: error.message,
      stack: error.stack 
    });
    
    // Fallback: mantieni file esistente se possibile
    if (fs.existsSync(CONFIG.OUTPUT_PATH)) {
      console.log('🔄 Mantengo l\'index.html esistente come fallback');
      process.exit(0);
    } else {
      console.log('💥 Nessun fallback disponibile');
      process.exit(1);
    }
  }
}

// ==========================================
// AVVIO APPLICAZIONE
// ==========================================

// Gestione segnali per cleanup
process.on('SIGINT', () => {
  console.log('\n🛑 Build interrotto dall\'utente');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Build terminato dal sistema');
  process.exit(0);
});

// Avvia il processo
main().catch(error => {
  console.error('💥 Errore fatale:', error);
  process.exit(1);
});