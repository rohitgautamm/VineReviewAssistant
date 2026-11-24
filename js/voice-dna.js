/**
 * VinePilot AI — Personal Voice DNA & Human Tone Engine
 * Learns the user's authentic writing voice from sample reviews + custom instructions
 * and builds anti-robotic prompts and fallback human drafts.
 */
(function (root) {
  'use strict';

  const TONE_PRESETS = {
    speech_cleanup: {
      label: '🎙️ Speech-to-Text Cleanup Only (Default — Add Nothing)',
      description: 'Strictly corrects spelling, grammar, and speech-to-text mistranscribed words that do not fit the product context. Does NOT add or invent anything.',
      promptRule: 'Strictly proofread the user\'s speech-to-text input: fix only spelling, punctuation, and misheard words that do not fit the product context. Do NOT add any new sentences, fluff, or extra points.'
    },
    balanced: {
      label: 'Balanced & Honest',
      description: 'Natural, conversational shopper tone. Mixes real praise with practical caveats.',
      promptRule: 'Write with a grounded, conversational, everyday shopper tone. Balance what worked well with practical observations or minor quirks.'
    },
    casual_human: {
      label: 'Casual Lived-In Storyteller',
      description: 'Sounds like a friend texting you how the product actually worked in daily life.',
      promptRule: 'Write in a relaxed, informal first-person voice using contractions ("I\'ve", "didn\'t", "it\'s"). Start right in the middle of why you needed it or what happened when you opened and used it.'
    },
    hands_on_tester: {
      label: 'Hands-On Gear / Detail Tester',
      description: 'Focuses on build quality, fit, materials, dimensions, and real-world durability.',
      promptRule: 'Focus on tactile build quality, materials, fitment, setup experience, and how it holds up under actual use. Avoid fluff adjectives; prefer concrete observations.'
    },
    enthusiastic: {
      label: 'Warm & Enthusiastic',
      description: 'Upbeat and appreciative while still sounding like a genuine human buyer.',
      promptRule: 'Write with warm, genuine enthusiasm grounded in specific things you liked using, without sounding like a marketing brochure.'
    },
    critical: {
      label: 'Direct & Critical',
      description: 'No-nonsense breakdown of flaws, value vs. price, and where the item falls short.',
      promptRule: 'Be candid, fair, and direct about shortcomings, build compromises, or misleading listing details while noting any redeeming qualities.'
    },
    concise: {
      label: 'Short & Punchy',
      description: 'Quick 1-paragraph summary + key takeaways for fast mobile readers.',
      promptRule: 'Keep it tight and direct. Get straight to how it works, the best feature, any catch, and whether it is worth picking up.'
    }
  };

  const LENGTH_PRESETS = {
    short: { label: 'Short (60–100 words)', wordTarget: '60 to 100 words (1 short paragraph)' },
    medium: { label: 'Medium (110–180 words)', wordTarget: '110 to 180 words (2 natural paragraphs)' },
    long: { label: 'Detailed (200–300 words)', wordTarget: '200 to 300 words (2–3 paragraphs with deep hands-on detail)' }
  };

  /**
   * Analyze user's past reviews to extract measurable Voice DNA traits
   */
  function analyzeVoiceSamples(samples = []) {
    const valid = samples.map(s => String(s || '').trim()).filter(s => s.length > 30);
    if (!valid.length) {
      return {
        sampleCount: 0,
        avgWords: 130,
        avgSentenceLength: 15,
        usesBullets: false,
        contractionRate: 'high',
        openingStyle: 'Direct hands-on context ("I ordered this for...")',
        styleSummary: 'Conversational first-person human reviewer; avoids AI buzzwords.'
      };
    }

    const totalWords = valid.reduce((sum, s) => sum + s.split(/\s+/).length, 0);
    const avgWords = Math.round(totalWords / valid.length);

    const allSentences = valid.flatMap(s => s.split(/[.!?]+/).map(x => x.trim()).filter(Boolean));
    const avgSentenceLength = allSentences.length
      ? Math.round(totalWords / allSentences.length)
      : 15;

    const usesBullets = valid.some(s => /(^|\n)\s*[-•*]\s+/m.test(s));
    const usesExclamation = valid.some(s => /!/.test(s));
    const usesParentheses = valid.some(s => /\([^)]+\)/.test(s));

    const traits = [
      `Average review length around ${avgWords} words`,
      `Average sentence length ~${avgSentenceLength} words`,
      usesBullets ? 'Occasionally uses short bullet points after a narrative intro' : 'Prefers flowing paragraphs over bullet lists',
      usesParentheses ? 'Uses conversational parenthetical asides (like this) for extra context' : 'Clean, direct sentence structure',
      usesExclamation ? 'Warm punctuation with occasional exclamation marks' : 'Calm, matter-of-fact punctuation'
    ];

    return {
      sampleCount: valid.length,
      avgWords,
      avgSentenceLength,
      usesBullets,
      usesParentheses,
      usesExclamation,
      styleSummary: traits.join(' · ')
    };
  }

  /**
   * Combine user's raw speech-to-text / input fields in the order they provided them
   */
  function collectUserRawSpeechText(context = {}) {
    const parts = [
      (context.usage || '').trim(),
      (context.liked || '').trim(),
      (context.disliked || '').trim(),
      (context.notes || '').trim()
    ]
      .map(s => s.replace(/^[-•*]\s*/gm, '').trim())
      .filter(Boolean);

    if (parts.length > 0) return parts.join('\n\n');
    return (context.rawDraft || '').trim();
  }

  /**
   * Build the full prompt for AI generation (Gemini / OpenAI / Claude / External AI)
   */
  function buildReviewPrompt({ product, context, voiceProfile, aspects = [] }) {
    const isSpeechCleanup = !context.tone || context.tone === 'speech_cleanup';

    if (isSpeechCleanup) {
      const rawSpeech = collectUserRawSpeechText(context);
      const existingHeadline = (context.rawTitle || '').trim();
      return `I am converting my speech-to-text product review into text.

HINDI INPUT RULE: My notes may be spoken in Hindi, Hinglish, Marathi, Punjabi, Malayalam, Kannada, Telugu or Tamil (native script or English letters). If so, translate them into natural, simple English in MY everyday style (casual, first person, how an Indian reviewer would actually write) while keeping the exact meaning, context, details and sentence order. Do NOT embellish, add claims, or make it sound fancy. Words already in English stay as they are.

YOUR ONLY JOB (the final output must ALWAYS be in English, never Hindi or Hinglish):
0. If any part of my input is Hindi/Hinglish, translate it to English first. The output must contain no Hindi words and no Devanagari.
1. Correct any spelling mistakes, typos, capitalization, and missing punctuation.
2. If a word was misheard by speech-to-text and does not fit the context or the product below, fix ONLY that word to the intended word that fits the product context.
3. (Applies AFTER translation, never instead of it.) DO NOT add anything from your end. Do NOT rewrite my sentences, do NOT change my tone, do NOT expand short sentences, and do NOT add any intro, conclusion, or extra product claims. Keep 100% of my words and meaning intact.
4. For the "title" field: ${existingHeadline ? `Proofread my headline ("${existingHeadline}") using the exact same rule.` : 'Create a simple 4-to-8 word headline using ONLY words/points I already said in my text.'}

PRODUCT CONTEXT (use ONLY to identify speech-to-text misheard words):
- Product Title: ${product.title || 'Product'}
- Product Details: ${(product.description || 'N/A').slice(0, 1500)}

MY RAW SPEECH-TO-TEXT INPUT:
"""
${rawSpeech}
"""

OUTPUT FORMAT:
Return valid JSON with two keys:
{
  "title": "Short corrected headline (no quotes)",
  "body": "My exact review text with only spelling and out-of-context speech-to-text words fixed"
}`;
    }

    const toneObj = TONE_PRESETS[context.tone] || TONE_PRESETS.balanced;
    const lengthObj = LENGTH_PRESETS[context.length] || LENGTH_PRESETS.medium;
    const dna = analyzeVoiceSamples(voiceProfile?.samples || []);

    const aspectsList = Array.isArray(aspects) && aspects.length
      ? aspects.map(a => typeof a === 'string' ? a : a.name).filter(Boolean)
      : [];

    const likedBullets = (context.liked || '').trim() || 'Works as described in my testing';
    const dislikedBullets = (context.disliked || '').trim() || 'No major dealbreakers so far';
    const usageText = (context.usage || '').trim() || 'Tested in everyday household use';
    const extraNotes = (context.notes || '').trim();
    const customInstructions = (voiceProfile?.customInstructions || '').trim();
    const personaBio = (voiceProfile?.personaBio || '').trim();

    let voiceSection = `VOICE & TONE PROFILE:\n- Selected Tone: ${toneObj.label} — ${toneObj.promptRule}\n- Target Length: ${lengthObj.wordTarget}`;
    if (personaBio) {
      voiceSection += `\n- Reviewer Persona / Background: ${personaBio}`;
    }
    if (customInstructions) {
      voiceSection += `\n- Reviewer's Permanent Rules: ${customInstructions}`;
    }
    if (voiceProfile?.useProfile !== false && voiceProfile?.samples?.length) {
      voiceSection += `\n- Voice DNA Analysis from Reviewer's Past Reviews: ${dna.styleSummary}\n- Past Review Writing Samples (match this exact cadence, vocabulary, and personality):\n`;
      voiceProfile.samples.slice(0, 3).forEach((samp, idx) => {
        voiceSection += `  [Sample ${idx + 1}]: "${samp.slice(0, 600).replace(/\s+/g, ' ')}"\n`;
      });
    }

    const aspectInstruction = aspectsList.length
      ? `\nAMAZON "IDEAS" TOPICS TO NATURALLY COVER:\nAmazon's form checks whether the review touches on these topics: [${aspectsList.join(', ')}]. Weave them naturally into your experience without listing them robotically.`
      : '';

    return `You are helping a real Amazon Vine member write an authentic, human-sounding review based on their actual hands-on experience and bullet points.

${voiceSection}

HINDI INPUT RULE: My notes may be spoken in Hindi, Hinglish, Marathi, Punjabi, Malayalam, Kannada, Telugu or Tamil (native script or English letters). If so, translate them into natural, simple English in MY everyday style (casual, first person, how an Indian reviewer would actually write) while keeping the exact meaning, context, details and sentence order. Do NOT embellish, add claims, or make it sound fancy. Words already in English stay as they are.

STRICT ANTI-AI & AUTHENTICITY RULES:
1. Sound 100% like a real person who held and used this item—NOT a copywriter or AI.
2. NEVER use AI giveaway words: "delve", "testament", "game-changer", "elevate", "boasts", "unparalleled", "look no further", "exceeded my expectations", "in conclusion", "moreover", "furthermore", "seamlessly", or em-dashes ("—"). Use normal hyphens ("-") or commas instead.
3. Vary sentence lengths naturally. Include specific tactile or practical details from the user's bullet points and attached photos.
4. Do NOT echo the full clunky SEO product title in the review body; call the product what a normal person would call it (e.g., "this desk lamp", "the silicone mat", "this 20W charger").

STRICT AMAZON COMMUNITY GUIDELINES (ZERO REJECTION POLICY):
1. NEVER mention receiving the product for free, Amazon Vine, ETV, or promotional exchange (Amazon adds the Vine badge automatically).
2. NEVER mention shipping speed, delivery drivers, outer Amazon shipping boxes/mailers, or third-party sellers.
3. NEVER make medical, disease, or FDA cure/treatment claims (e.g., do not say "cured pain", "heals eczema", "treats insomnia", "anti-inflammatory"—use safe subjective comfort phrases instead).
4. NEVER mention competing store names (Walmart, Temu, AliExpress, Target, etc.), URLs, or call the item "counterfeit/scam".
${aspectInstruction}

PRODUCT DETAILS:
- Product Title: ${product.title || 'Product'}
- ASIN: ${product.asin || 'N/A'}
- Listing Description / Bullets: ${(product.description || 'N/A').slice(0, 2500)}

MY HANDS-ON EXPERIENCE & BULLET POINTS:
- Star Rating: ${context.rating || 5} out of 5 stars
- How / Why I Used It: ${usageText}
- What I Liked (Pros / Highlights): ${likedBullets}
- What I Disliked (Cons / Nitpicks): ${dislikedBullets}
- Extra Notes / Specifics: ${extraNotes || 'None'}
- Would I Recommend It?: ${context.recommend === true ? 'Yes' : context.recommend === false ? 'No' : 'Depends on the buyer'}

OUTPUT FORMAT:
Return valid JSON with two keys:
{
  "title": "A short, natural, human review headline (4 to 9 words, no quotes)",
  "body": "The review body text using \\n\\n for paragraph breaks"
}`;
  }

  /**
   * Basic offline spelling & speech-to-text typo fixer (adds nothing from its end)
   */
  function cleanSpeechTextLocally(text = '') {
    const COMMON_TYPOS = {
      'shiopping': 'shopping',
      'stiching': 'stitching',
      'recieved': 'received',
      'definately': 'definitely',
      'seperate': 'separate',
      'occured': 'occurred',
      'untill': 'until',
      'alot': 'a lot',
      'wont': "won't",
      'dont': "don't",
      'didnt': "didn't",
      'doesnt': "doesn't",
      'isnt': "isn't",
      'wasnt': "wasn't",
      'cant': "can't",
      'ive': "I've",
      'im': "I'm",
      'id': "I'd",
      'theres': "there's",
      'thats': "that's",
      'overalll': 'overall',
      'qualilty': 'quality',
      'comfortabley': 'comfortably',
      'sturdey': 'sturdy',
      'lightwieght': 'lightweight',
      'batery': 'battery',
      'packagingg': 'packaging'
    };

    return String(text || '')
      .split(/\n{2,}/)
      .map(paragraph => {
        let p = paragraph
          .replace(/^[-•*]\s*/gm, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!p) return '';
        // Fix standalone lowercase "i"
        p = p.replace(/\bi\b/g, 'I');
        // Fix common typos preserving case if capitalized
        p = p.replace(/\b([A-Za-z]+)\b/g, (word) => {
          const lower = word.toLowerCase();
          if (COMMON_TYPOS[lower]) {
            const replacement = COMMON_TYPOS[lower];
            return word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()
              ? capitalize(replacement)
              : replacement;
          }
          return word;
        });
        p = ensurePeriod(capitalize(p));
        return p;
      })
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * Smart Local Human Review Synthesizer (works offline or when no external API key is configured,
   * turning user's bullet points + usage context into an authentic, non-robotic human review)
   */
  function synthesizeLocalHumanReview({ product, context, voiceProfile, aspects = [] }) {
    const isSpeechCleanup = !context.tone || context.tone === 'speech_cleanup';
    const rawSpeech = collectUserRawSpeechText(context);

    if (isSpeechCleanup && rawSpeech) {
      const cleanedBody = cleanSpeechTextLocally(rawSpeech);
      const firstSentenceWords = cleanedBody.split(/[.!?\n]/)[0].trim().split(/\s+/).slice(0, 8).join(' ');
      const cleanedTitle = (context.rawTitle || '').trim()
        ? cleanSpeechTextLocally(context.rawTitle).replace(/\.$/, '')
        : firstSentenceWords;
      return {
        title: cleanedTitle.slice(0, 120),
        body: cleanedBody
      };
    }

    const rawTitle = (product.title || 'this item').trim();
    // Extract a short, natural noun phrase for the product instead of the 200-char SEO title
    const shortName = extractNaturalProductName(rawTitle);
    const rating = Number(context.rating) || 4;
    const usage = (context.usage || '').trim();
    const likedItems = parseBullets(context.liked);
    const dislikedItems = parseBullets(context.disliked);
    const extraNotes = (context.notes || '').trim();

    // Generate a natural human headline
    let headline = '';
    if (rating === 5) {
      headline = likedItems[0]
        ? `Solid ${shortName} - ${ compressForHeadline(likedItems[0]) }`
        : `Really happy with how this ${shortName} performs`;
    } else if (rating === 4) {
      headline = likedItems[0]
        ? `Good ${shortName} overall, with a minor caveat`
        : `Works well for daily use, just one small nitpick`;
    } else if (rating === 3) {
      headline = `Decent ${shortName}, though a mixed bag in practice`;
    } else {
      headline = dislikedItems[0]
        ? `Disappointing ${shortName} - ${ compressForHeadline(dislikedItems[0]) }`
        : `Fell short of what I hoped for`;
    }

    const paragraphs = [];

    // Paragraph 1: Why I got it / How I used it + initial hands-on impression
    let p1 = '';
    if (usage) {
      p1 += /^i\b/i.test(usage)
        ? `${ensurePeriod(capitalize(usage))} `
        : `I picked up this ${shortName} for ${usage.replace(/\.$/, '')}. `;
    } else {
      p1 += `I've been spending some time testing out this ${shortName} in my regular routine. `;
    }

    if (likedItems.length > 0) {
      const firstLikes = likedItems.slice(0, 2).map(s => lowerFirstIfFragment(s)).join(', and ');
      p1 += `Right away, what stood out to me is that ${firstLikes}. `;
      if (likedItems.length > 2) {
        const moreLikes = likedItems.slice(2).map(s => ensurePeriod(capitalize(s))).join(' ');
        p1 += moreLikes + ' ';
      }
    } else if (rating >= 4) {
      p1 += `The build feels solid in hand and it matched what I was expecting from the listing photos. `;
    }

    paragraphs.push(p1.trim());

    // Paragraph 2: Extra notes, nuances, downsides, and missing Amazon Ideas aspects
    let p2 = '';
    if (extraNotes) {
      p2 += `${ensurePeriod(capitalize(extraNotes))} `;
    }

    if (dislikedItems.length > 0) {
      const transition = rating >= 4 ? 'The only minor gripe I ran into is that ' : 'On the downside, ';
      p2 += `${transition}${lowerFirstIfFragment(dislikedItems[0])}. `;
      if (dislikedItems.length > 1) {
        p2 += `Also, ${dislikedItems.slice(1).map(s => lowerFirstIfFragment(s)).join(' and ')}. `;
      }
    } else if (rating === 4) {
      p2 += `No major complaints so far, just takes a quick moment to get dialed in the way you like it. `;
    }

    // Naturally touch on any Amazon "Ideas" topics if present
    const unticked = (aspects || []).map(a => typeof a === 'string' ? a : a.name).filter(Boolean);
    if (unticked.length) {
      const hasValue = unticked.some(a => /value|price|worth/i.test(a));
      const hasEase = unticked.some(a => /ease|easy|install|setup/i.test(a));
      if (hasEase && !/easy|setup|install/i.test(p1 + p2)) {
        p2 += `Setup was straightforward right out of the box without needing to fuss with instructions. `;
      }
      if (hasValue && !/value|price|worth/i.test(p1 + p2)) {
        p2 += rating >= 4
          ? `Given the build quality and how well it works, I think the value for the price is fair. `
          : `Considering the current price point, the overall value feels a bit questionable. `;
      }
    }

    // Closing recommendation
    if (context.recommend === true || (context.recommend === null && rating >= 4)) {
      p2 += `Overall, if you're looking for a dependable ${shortName}, this one has held up well for me and is easy to recommend.`;
    } else if (context.recommend === false || rating <= 2) {
      p2 += `Overall, I'd probably pass on this one unless those specific drawbacks don't bother you.`;
    } else {
      p2 += `Overall, it gets the job done as long as you keep those details in mind before ordering.`;
    }

    if (p2.trim()) paragraphs.push(p2.trim());

    const cleanBody = root.VinePilotGuidelines
      ? root.VinePilotGuidelines.autoFixText(paragraphs.join('\n\n'))
      : paragraphs.join('\n\n');

    return {
      title: headline.slice(0, 120),
      body: cleanBody
    };
  }

  function extractNaturalProductName(title = '') {
    if (!title) return 'item';
    // Strip brand ALL-CAPS prefix and take the core 2-4 words before commas, dashes, or "for/with"
    const cleaned = title
      .replace(/^\[[^\]]+\]\s*/, '')
      .split(/[,|–—-]|(?:\b(?:for|with|compatible|pack of|set of)\b)/i)[0]
      .trim();
    const words = cleaned.split(/\s+/).filter(w => !/^\d+(?:pcs|pack|oz|ml|gb|tb|inch|mm|ft)$/i.test(w));
    if (words.length <= 4) return words.join(' ').toLowerCase() || 'product';
    return words.slice(-3).join(' ').toLowerCase();
  }

  function parseBullets(text = '') {
    return String(text || '')
      .split(/[\n•*]+|(?:\s+-\s+)/)
      .map(s => s.replace(/^[-•*\d.)\s]+/, '').trim())
      .filter(Boolean);
  }

  function capitalize(s = '') {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  function ensurePeriod(s = '') {
    const t = s.trim();
    return /[.!?]$/.test(t) ? t : t + '.';
  }

  function lowerFirstIfFragment(s = '') {
    const t = s.trim().replace(/\.$/, '');
    if (!t) return '';
    if (/^I\b/.test(t)) return t;
    return t.charAt(0).toLowerCase() + t.slice(1);
  }

  function compressForHeadline(s = '') {
    const clean = s.replace(/[.!?]+$/, '').trim();
    const words = clean.split(/\s+/);
    return words.slice(0, 6).join(' ');
  }

  root.VinePilotVoice = {
    TONE_PRESETS,
    LENGTH_PRESETS,
    analyzeVoiceSamples,
    buildReviewPrompt,
    synthesizeLocalHumanReview
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
