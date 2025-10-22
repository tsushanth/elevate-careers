import { pipeline, cos_sim } from '@xenova/transformers';

let embedder = null;

// Initialize the model (runs once)
export async function initEmbedder() {
  if (!embedder) {
    console.log('🧠 Loading embedding model...');
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
      progress_callback: (progress) => {
        if (progress.status === 'downloading') {
          console.log(`📥 Downloading: ${progress.file} - ${Math.round(progress.progress)}%`);
        }
      }
    });
    console.log('✅ Embedding model loaded!');
  }
  return embedder;
}

// Generate embedding for text
export async function generateEmbedding(text) {
  if (!embedder) await initEmbedder();
  
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data); // Convert to regular array
}

// Pre-computed profile field embeddings (computed on first run, then cached)
let PROFILE_EMBEDDINGS = null;

export async function initProfileEmbeddings() {
  if (PROFILE_EMBEDDINGS) return PROFILE_EMBEDDINGS;
  
  console.log('🔧 Pre-computing profile embeddings...');
  
  PROFILE_EMBEDDINGS = {
    firstName: await generateEmbedding('first name given name legal first name forename'),
    lastName: await generateEmbedding('last name surname family name legal last name'),
    email: await generateEmbedding('email address e-mail electronic mail contact email'),
    phone: await generateEmbedding('phone number telephone mobile cell number contact number'),
    linkedin: await generateEmbedding('linkedin profile linkedin url linkedin account social media'),
    github: await generateEmbedding('github profile github username github account code repository'),
    portfolio: await generateEmbedding('portfolio website personal website portfolio url web portfolio'),
    location: await generateEmbedding('city location address city name current location residence'),
    workAuth: await generateEmbedding('work authorization authorized to work work permit employment authorization legally authorized'),
    address: await generateEmbedding('street address address line home address mailing address'),
    postalCode: await generateEmbedding('postal code zip code postcode zip mail code'),
    state: await generateEmbedding('state province region territory'),
    country: await generateEmbedding('country nation')
  };
  
  console.log('✅ Profile embeddings ready!');
  return PROFILE_EMBEDDINGS;
}

// Match a field label to a profile key using embeddings
export async function matchFieldToProfile(fieldLabel, fieldName = '', placeholder = '') {
  // Combine all available context
  const contextText = [fieldLabel, fieldName, placeholder]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  
  if (!contextText.trim()) {
    return { key: null, confidence: 0, reason: 'No text to match' };
  }
  
  const profileEmbs = await initProfileEmbeddings();
  const fieldEmbedding = await generateEmbedding(contextText);
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const [key, profileEmb] of Object.entries(profileEmbs)) {
    const similarity = cos_sim(fieldEmbedding, profileEmb);
    
    if (similarity > bestScore) {
      bestScore = similarity;
      bestMatch = key;
    }
  }
  
  // Thresholds
  const CONFIDENT_THRESHOLD = 0.65;
  const SKIP_THRESHOLD = 0.40;
  
  let confidence = 'high';
  if (bestScore < SKIP_THRESHOLD) {
    confidence = 'skip';
    bestMatch = null;
  } else if (bestScore < CONFIDENT_THRESHOLD) {
    confidence = 'low';
  }
  
  return {
    key: bestMatch,
    confidence: confidence,
    score: bestScore.toFixed(3),
    reason: confidence === 'skip' ? 'No good match found' : `Matched with ${(bestScore * 100).toFixed(1)}% confidence`
  };
}