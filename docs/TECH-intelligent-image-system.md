# Technical Documentation: Intelligent Image System

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Client                                      │
│  boards/index.html                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   addLink() ──► resolveImage() ──► updateLinkImage()                   │
│                      │                                                  │
│                      ▼                                                  │
│              ┌──────────────┐                                          │
│              │ Image Worker │  (background processing)                  │
│              └──────────────┘                                          │
│                      │                                                  │
└──────────────────────┼──────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Edge Functions                                   │
│  supabase/functions/                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  classify-content/     ──► Content type detection                       │
│  resolve-image/        ──► Image resolution pipeline                    │
│  discover-types/       ──► Weekly type discovery job                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Database                                        │
│  Supabase PostgreSQL                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  domain_profiles       ──► Cached domain classifications                │
│  content_types         ──► Type registry (builtin + discovered)         │
│  image_strategies      ──► Visual strategies per type                   │
│  classification_log    ──► Tracking for type discovery                  │
│  links                 ──► Updated with image_url, image_source         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        External APIs                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Anthropic / OpenAI    ──► Classification, generation prompts           │
│  Unsplash API          ──► Image search                                 │
│  Platform APIs         ──► YouTube, Spotify, GitHub thumbnails          │
│  Supabase Storage      ──► User uploads, generated images               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### New Tables

```sql
-- Content type registry (builtin + auto-discovered)
CREATE TABLE content_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  definition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'builtin', -- builtin, discovered, proposed
  signals JSONB DEFAULT '{}',
  -- signals: { domains: [], url_patterns: [], keywords: [] }
  sample_count INTEGER DEFAULT 0,
  discovered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Domain classification profiles
CREATE TABLE domain_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT UNIQUE NOT NULL,
  classification TEXT NOT NULL DEFAULT 'unknown', -- single_type, multi_type, unknown
  primary_type TEXT REFERENCES content_types(name),
  path_patterns JSONB DEFAULT '[]',
  -- path_patterns: [{ pattern: "^/blog/", type: "article", confidence: 0.9 }]
  types_seen JSONB DEFAULT '{}',
  -- types_seen: { "article": 5, "product": 12 }
  sample_count INTEGER DEFAULT 0,
  confidence REAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Image strategies per content type
CREATE TABLE image_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type TEXT REFERENCES content_types(name),
  name TEXT NOT NULL,
  pipeline JSONB NOT NULL,
  -- pipeline: [{ method: "scrape", config: {}, timeout_ms: 1000 }, ...]
  card_template TEXT NOT NULL DEFAULT 'image_dominant',
  style JSONB DEFAULT '{}',
  -- style: { overlay_opacity: 0.7, text_position: "bottom" }
  is_active BOOLEAN DEFAULT true,
  performance_score REAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Classification log for type discovery
CREATE TABLE classification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID REFERENCES links(id),
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  description TEXT,
  predicted_type TEXT,
  confidence REAL,
  embedding VECTOR(1536), -- for clustering
  is_uncertain BOOLEAN DEFAULT false,
  user_override TEXT, -- if user changed the type/image
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for clustering uncertain classifications
CREATE INDEX idx_classification_uncertain
ON classification_log(is_uncertain, created_at)
WHERE is_uncertain = true;
```

### Links Table Updates

```sql
-- Add new columns to existing links table
ALTER TABLE links ADD COLUMN IF NOT EXISTS
  content_type TEXT DEFAULT 'unknown';

ALTER TABLE links ADD COLUMN IF NOT EXISTS
  image_source TEXT DEFAULT 'scraped';
  -- scraped, searched, generated, uploaded, platform_api

ALTER TABLE links ADD COLUMN IF NOT EXISTS
  image_resolved_at TIMESTAMPTZ;

ALTER TABLE links ADD COLUMN IF NOT EXISTS
  type_confidence REAL;
```

---

## API Interfaces

### Content Classifier Interface

```typescript
// lib/classifier.ts

interface ClassifyInput {
  url: string;
  title: string;
  description: string;
  domain: string;
}

interface ClassifyResult {
  type: string;
  confidence: number;
  signals: string[];
}

interface ContentClassifier {
  classify(input: ClassifyInput): Promise<ClassifyResult>;
  classifyBatch(inputs: ClassifyInput[]): Promise<ClassifyResult[]>;
}

// Provider implementations
class AnthropicClassifier implements ContentClassifier {
  private model = 'claude-3-haiku-20240307';

  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    const prompt = this.buildPrompt(input);
    const response = await anthropic.messages.create({
      model: this.model,
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }]
    });
    return this.parseResponse(response);
  }

  async classifyBatch(inputs: ClassifyInput[]): Promise<ClassifyResult[]> {
    const prompt = this.buildBatchPrompt(inputs);
    const response = await anthropic.messages.create({
      model: this.model,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    });
    return this.parseBatchResponse(response);
  }

  private buildPrompt(input: ClassifyInput): string {
    return `Classify this link into one content type.

URL: ${input.url}
Title: ${input.title}
Description: ${input.description}

Types: product, article, video, music, repository, social, document, tool, unknown

JSON only: {"type": "...", "confidence": 0.0-1.0, "signals": ["why"]}`;
  }
}

class OpenAIClassifier implements ContentClassifier {
  // Similar implementation for OpenAI
}

class LocalClassifier implements ContentClassifier {
  // Ollama/llama.cpp implementation for self-hosting
}

// Factory
function createClassifier(): ContentClassifier {
  const provider = process.env.CLASSIFIER_PROVIDER || 'anthropic';
  switch (provider) {
    case 'anthropic': return new AnthropicClassifier();
    case 'openai': return new OpenAIClassifier();
    case 'local': return new LocalClassifier();
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}
```

### Image Resolver Interface

```typescript
// lib/image-resolver.ts

interface ResolveInput {
  url: string;
  title: string;
  description: string;
  contentType: string;
}

interface ResolveResult {
  imageUrl: string;
  source: 'scraped' | 'searched' | 'generated' | 'platform_api' | 'template';
  method: string;
  processingTime: number;
}

interface ImageResolver {
  resolve(input: ResolveInput, strategy: ImageStrategy): Promise<ResolveResult>;
}

class ImageResolverImpl implements ImageResolver {
  async resolve(input: ResolveInput, strategy: ImageStrategy): Promise<ResolveResult> {
    const startTime = Date.now();

    for (const approach of strategy.pipeline) {
      try {
        const result = await this.executeApproach(input, approach);
        if (result) {
          return {
            imageUrl: result,
            source: this.getSource(approach.method),
            method: approach.method,
            processingTime: Date.now() - startTime
          };
        }
      } catch (e) {
        console.error(`Approach ${approach.method} failed:`, e);
        continue;
      }
    }

    // All approaches failed - return template card
    return {
      imageUrl: await this.generateTemplateCard(input),
      source: 'template',
      method: 'styled_card',
      processingTime: Date.now() - startTime
    };
  }

  private async executeApproach(
    input: ResolveInput,
    approach: ImageApproach
  ): Promise<string | null> {
    const timeout = approach.timeout_ms || 3000;

    switch (approach.method) {
      case 'scrape':
        return this.scrapeImage(input.url, approach.config, timeout);
      case 'search':
        return this.searchImage(input.title, approach.config, timeout);
      case 'generate':
        return this.generateImage(input, approach.config, timeout);
      case 'platform_api':
        return this.fetchFromPlatform(input.url, approach.config, timeout);
      default:
        return null;
    }
  }
}
```

---

## Domain Profile Manager

```typescript
// lib/domain-profile.ts

interface DomainProfile {
  domain: string;
  classification: 'single_type' | 'multi_type' | 'unknown';
  primaryType?: string;
  pathPatterns: PathPattern[];
  typesSeen: Record<string, number>;
  sampleCount: number;
  confidence: number;
}

interface PathPattern {
  pattern: string; // regex string
  type: string;
  confidence: number;
  examples: string[];
}

class DomainProfileManager {
  constructor(private db: Database) {}

  async getProfile(domain: string): Promise<DomainProfile | null> {
    return this.db.domainProfiles.findOne({ domain });
  }

  async classifyWithProfile(
    url: string,
    title: string,
    description: string
  ): Promise<ClassifyResult> {
    const { hostname: domain, pathname: path } = new URL(url);
    const profile = await this.getProfile(domain);

    // Unknown domain - need API call
    if (!profile || profile.classification === 'unknown') {
      const result = await classifier.classify({ url, title, description, domain });
      await this.updateProfile(domain, path, result);
      return result;
    }

    // Single-type domain - return cached
    if (profile.classification === 'single_type' && profile.confidence > 0.9) {
      return {
        type: profile.primaryType!,
        confidence: profile.confidence,
        signals: ['cached_domain_profile']
      };
    }

    // Multi-type domain - try path patterns
    if (profile.classification === 'multi_type') {
      for (const pattern of profile.pathPatterns) {
        if (new RegExp(pattern.pattern).test(path)) {
          return {
            type: pattern.type,
            confidence: pattern.confidence,
            signals: ['path_pattern_match']
          };
        }
      }
      // No pattern match - need API call
      const result = await classifier.classify({ url, title, description, domain });
      await this.learnPathPattern(profile, path, result);
      return result;
    }

    // Fallback to API
    return classifier.classify({ url, title, description, domain });
  }

  async updateProfile(
    domain: string,
    path: string,
    result: ClassifyResult
  ): Promise<void> {
    let profile = await this.getProfile(domain);

    if (!profile) {
      profile = {
        domain,
        classification: 'unknown',
        pathPatterns: [],
        typesSeen: {},
        sampleCount: 0,
        confidence: 0
      };
    }

    // Track types seen
    profile.typesSeen[result.type] = (profile.typesSeen[result.type] || 0) + 1;
    profile.sampleCount++;

    // After enough samples, determine classification
    if (profile.sampleCount >= 5) {
      const types = Object.keys(profile.typesSeen);
      const dominant = Object.entries(profile.typesSeen)
        .sort((a, b) => b[1] - a[1])[0];
      const dominantRatio = dominant[1] / profile.sampleCount;

      if (types.length === 1 || dominantRatio > 0.95) {
        profile.classification = 'single_type';
        profile.primaryType = dominant[0];
        profile.confidence = dominantRatio;
      } else {
        profile.classification = 'multi_type';
        profile.confidence = 0.8;
      }
    }

    await this.db.domainProfiles.upsert(profile);
  }

  async learnPathPattern(
    profile: DomainProfile,
    path: string,
    result: ClassifyResult
  ): Promise<void> {
    // Store sample for pattern analysis
    if (!profile.pathSamples) profile.pathSamples = [];
    profile.pathSamples.push({ path, type: result.type });

    // Analyze patterns periodically
    if (profile.pathSamples.length % 10 === 0) {
      const patterns = await this.analyzePathPatterns(profile);
      profile.pathPatterns = patterns;
    }

    await this.db.domainProfiles.upsert(profile);
  }

  private async analyzePathPatterns(profile: DomainProfile): Promise<PathPattern[]> {
    const prompt = `Analyze URL paths and find patterns:

${profile.pathSamples.map(s => `${s.path} → ${s.type}`).join('\n')}

Return JSON array of patterns:
[{"pattern": "^/blog/", "type": "article", "confidence": 0.9}]`;

    const response = await classifier.complete(prompt);
    return JSON.parse(response);
  }
}
```

---

## Type Discovery System

```typescript
// lib/type-discovery.ts

interface TypeProposal {
  name: string;
  definition: string;
  signals: {
    domains: string[];
    urlPatterns: string[];
    keywords: string[];
  };
  confidence: number;
  sampleCount: number;
  imageStrategy: ImageStrategy;
}

class TypeDiscoveryService {
  constructor(
    private db: Database,
    private classifier: ContentClassifier
  ) {}

  // Run weekly as scheduled job
  async discoverNewTypes(): Promise<TypeProposal[]> {
    // Get uncertain classifications from last 30 days
    const uncertain = await this.db.classificationLog.find({
      isUncertain: true,
      createdAt: { $gt: thirtyDaysAgo() }
    });

    if (uncertain.length < 50) return [];

    // Cluster by embedding similarity
    const clusters = await this.clusterByEmbedding(uncertain);

    const proposals: TypeProposal[] = [];

    for (const cluster of clusters) {
      if (cluster.length < 10) continue;

      const proposal = await this.analyzeCluster(cluster);
      if (proposal && proposal.confidence > 0.8) {
        const validated = await this.validateProposal(proposal, cluster);
        if (validated) {
          proposals.push(proposal);
        }
      }
    }

    return proposals;
  }

  private async analyzeCluster(cluster: ClassificationLog[]): Promise<TypeProposal | null> {
    const samples = cluster.slice(0, 20);

    const prompt = `Analyze these links that our classifier struggled with:

${samples.map(s => `- ${s.title} (${s.domain}): ${s.description?.slice(0, 100)}`).join('\n')}

If this is a distinct content type:
1. Name it
2. Define it
3. List signals (domains, URL patterns, keywords)
4. Suggest image strategy

JSON response:
{
  "isNewType": boolean,
  "name": "string",
  "definition": "string",
  "signals": { "domains": [], "urlPatterns": [], "keywords": [] },
  "confidence": 0.0-1.0,
  "imageStrategy": { "pipeline": [...], "cardTemplate": "..." }
}`;

    const response = await this.classifier.complete(prompt);
    const result = JSON.parse(response);

    if (!result.isNewType) return null;

    return {
      name: result.name,
      definition: result.definition,
      signals: result.signals,
      confidence: result.confidence,
      sampleCount: cluster.length,
      imageStrategy: result.imageStrategy
    };
  }

  private async validateProposal(
    proposal: TypeProposal,
    cluster: ClassificationLog[]
  ): Promise<boolean> {
    // Hold out 20% for testing
    const testSize = Math.floor(cluster.length * 0.2);
    const testSet = cluster.slice(-testSize);

    // Create temp classifier with new type
    const typesWithNew = await this.db.contentTypes.find();
    typesWithNew.push({ name: proposal.name, definition: proposal.definition });

    let correct = 0;
    for (const item of testSet) {
      const result = await this.classifier.classify({
        url: item.url,
        title: item.title,
        description: item.description,
        domain: item.domain
      });
      if (result.type === proposal.name && result.confidence > 0.7) {
        correct++;
      }
    }

    return (correct / testSize) > 0.8;
  }

  async promoteType(proposal: TypeProposal): Promise<void> {
    // Add to content_types
    await this.db.contentTypes.insert({
      name: proposal.name,
      definition: proposal.definition,
      status: 'discovered',
      signals: proposal.signals,
      sampleCount: proposal.sampleCount,
      discoveredAt: new Date()
    });

    // Add image strategy
    await this.db.imageStrategies.insert({
      contentType: proposal.name,
      ...proposal.imageStrategy,
      isActive: true
    });
  }
}
```

---

## Client-Side Integration

```javascript
// In boards/index.html

// Add to existing addLink function
async function addLink(url, metadata) {
  // ... existing logic ...

  // If no image, queue for resolution
  if (!metadata.image) {
    queueImageResolution(newLink.id, {
      url: url,
      title: metadata.title,
      description: metadata.description
    });
  }
}

// Background image resolution
const imageQueue = [];
let isProcessing = false;

function queueImageResolution(linkId, data) {
  imageQueue.push({ linkId, ...data });
  processImageQueue();
}

async function processImageQueue() {
  if (isProcessing || imageQueue.length === 0) return;
  isProcessing = true;

  while (imageQueue.length > 0) {
    const item = imageQueue.shift();
    try {
      const result = await resolveImage(item);
      if (result.imageUrl) {
        await updateLinkImage(item.linkId, result.imageUrl, result.source);
      }
    } catch (e) {
      console.error('Image resolution failed:', e);
    }
  }

  isProcessing = false;
}

async function resolveImage(item) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/resolve-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getAccessToken()}`
    },
    body: JSON.stringify(item)
  });
  return response.json();
}

async function updateLinkImage(linkId, imageUrl, source) {
  // Update in Supabase
  await fetch(`${SUPABASE_URL}/rest/v1/links?id=eq.${linkId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${getAccessToken()}`
    },
    body: JSON.stringify({
      image: imageUrl,
      image_source: source,
      image_resolved_at: new Date().toISOString()
    })
  });

  // Update UI - fade in new image
  const card = document.querySelector(`[data-id="${linkId}"]`);
  if (card) {
    const img = card.querySelector('.grid-item__image');
    if (img) {
      img.style.opacity = 0;
      img.src = imageUrl;
      img.onload = () => { img.style.opacity = 1; };
    } else {
      // Was placeholder, need to re-render
      renderGrid();
    }
  }
}
```

---

## Configuration

```typescript
// config/image-system.ts

export const config = {
  // Classification
  classifier: {
    provider: process.env.CLASSIFIER_PROVIDER || 'anthropic',
    model: process.env.CLASSIFIER_MODEL || 'claude-3-haiku-20240307',
    confidenceThreshold: 0.7,
    batchSize: 10,
    batchDelayMs: 1000
  },

  // Caching
  cache: {
    domainProfileTTL: 30 * 24 * 60 * 60, // 30 days
    singleTypeTTL: 30 * 24 * 60 * 60,
    multiTypePatternTTL: 30 * 24 * 60 * 60,
    unknownPathTTL: 7 * 24 * 60 * 60 // 7 days
  },

  // Image resolution
  resolution: {
    maxAttempts: 3,
    timeoutMs: 10000,
    defaultStrategy: 'unknown'
  },

  // Type discovery
  discovery: {
    minUncertainSamples: 50,
    minClusterSize: 10,
    validationThreshold: 0.8,
    autoPromoteConfidence: 0.9,
    autoPromoteMinSamples: 100
  },

  // Cost controls
  costs: {
    maxDailyApiCalls: 10000,
    maxMonthlySpend: 50 // USD
  }
};
```

---

## Deployment

### Supabase Edge Functions

```bash
# Deploy classification function
supabase functions deploy classify-content

# Deploy image resolution function
supabase functions deploy resolve-image

# Deploy type discovery (scheduled)
supabase functions deploy discover-types
```

### Database Migration

```bash
# Run migration for new tables
supabase db push
```

### Environment Variables

```bash
# Required
CLASSIFIER_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-...
OPENAI_API_KEY=sk-...  # backup provider

# Optional
UNSPLASH_ACCESS_KEY=...  # for image search
BROWSERLESS_API_KEY=...  # for headless scraping
```
