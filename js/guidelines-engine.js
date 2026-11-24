/**
 * VinePilot AI — Amazon Community Guidelines & Rejection Shield Engine
 * Checks reviews in real time against every known Amazon Vine rejection trigger,
 * predicts Amazon's "Review Insightfulness" score, and audits Human Authenticity.
 */
(function (root) {
  'use strict';

  const GUIDELINE_CATEGORIES = [
    {
      id: 'shipping_seller',
      severity: 'critical',
      title: 'Shipping, Delivery & Seller Mention',
      ruleSummary: 'Amazon rejects product reviews that focus on shipping speed, delivery drivers, outer shipping boxes, or third-party sellers.',
      patterns: [
        {
          regex: /\b(shipping box|padded envelope|bubble mailer|amazon box|outer box|delivery driver|prime delivery|shipped fast|arrived late|delayed shipping|damaged in transit|crushed box|carrier|ups|fedex|usps|dhl)\b/gi,
          issue: 'Mentions shipping container, carrier, or delivery experience.',
          suggestion: 'Remove shipping/delivery references, or clarify if you mean the product’s own storage case.',
          replacements: {
            'shipping box': 'product casing',
            'damaged in transit': 'had a blemish out of the box',
            'arrived late': '',
            'shipped fast': ''
          }
        },
        {
          regex: /\b(third[- ]party seller|contacted the seller|seller refunded|bad seller|great seller|customer service sent)\b/gi,
          issue: 'Mentions seller or fulfillment customer service (belongs in Seller Feedback, not Product Review).',
          suggestion: 'Focus strictly on how the physical product performs.',
          replacements: {}
        }
      ]
    },
    {
      id: 'medical_claims',
      severity: 'critical',
      title: 'Medical, Therapeutic or Disease Cure Claim',
      ruleSummary: 'Amazon’s automated health-compliance bot rejects reviews that claim a product cures, treats, heals, or prevents medical conditions (especially on supplements, skincare, braces, and wellness devices).',
      patterns: [
        {
          regex: /\b(cured?|heals?|healed|healing|treats?|treated|prevents?|remedy for|eliminated my pain|chronic pain|arthritis|tendonitis|carpal tunnel|sciatica|insomnia|anxiety|depression|adhd|migraines?|eczema|psoriasis|rosacea|acne|infection|inflammation|anti-inflammatory|blood pressure|diabetes|cholesterol|fda[- ]approved|clinically proven|medical grade)\b/gi,
          issue: 'Contains a medical/health condition or therapeutic claim that triggers Amazon’s automated review rejection bot.',
          suggestion: 'Use subjective comfort/wellness phrasing instead of medical terms (e.g., "feels soothing", "helped me unwind before bed", "comfortable wrist support").',
          replacements: {
            'cured': 'helped with',
            'heals': 'soothes',
            'healed': 'soothed',
            'healing': 'soothing',
            'inflammation': 'stiffness',
            'anti-inflammatory': 'soothing',
            'insomnia': 'winding down at night',
            'arthritis': 'stiff joints',
            'carpal tunnel': 'wrist fatigue from typing',
            'sciatica': 'lower back tightness',
            'anxiety': 'daily stress',
            'eczema': 'dry skin patches',
            'acne': 'blemishes',
            'eliminated my pain': 'felt much more comfortable',
            'chronic pain': 'daily soreness',
            'fda-approved': 'well-made',
            'clinically proven': 'consistent'
          }
        }
      ]
    },
    {
      id: 'vine_free_disclosure',
      severity: 'warning',
      title: 'Vine / Free Product / Tax Mention',
      ruleSummary: 'Amazon automatically adds the "Vine Customer Review of Free Product" badge. Mentioning getting it free, ETV, or tax value inside the text can trigger moderation filters.',
      patterns: [
        {
          regex: /\b(amazon vine|vine voice|vine program|got this (for )?free|received (this )?(for )?free|complimentary product|in exchange for (my |an )?honest review|etv|estimated taxable value|0\s*etv|\$0\s*etv|taxable value)\b/gi,
          issue: 'Mentions Amazon Vine, receiving the item for free, or ETV inside the review body.',
          suggestion: 'Let Amazon’s automatic Vine badge handle disclosure; focus on why you ordered the item and how you used it.',
          replacements: {
            'got this for free': 'picked this up',
            'received this for free': 'ordered this',
            'etv': 'price point',
            'estimated taxable value': 'listed price'
          }
        }
      ]
    },
    {
      id: 'competitor_pricing_links',
      severity: 'critical',
      title: 'External Retailers, Links, or Counterfeit Accusations',
      ruleSummary: 'Amazon prohibits URLs, contact info, naming competing stores (Temu, Walmart, AliExpress), or calling an item a "scam/counterfeit" in reviews.',
      patterns: [
        {
          regex: /\b(walmart|temu|aliexpress|alibaba|shein|ebay|costco|target|harbor freight|home depot|lowe'?s|best buy|ikea)\b/gi,
          issue: 'Names an external store or competing marketplace.',
          suggestion: 'Say "other big-box stores" or "budget import sites" instead of naming the competitor.',
          replacements: {
            'walmart': 'a local big-box store',
            'target': 'a local retail store',
            'temu': 'budget import sites',
            'aliexpress': 'overseas marketplaces',
            'shein': 'fast-fashion sites',
            'ebay': 'other online sites',
            'harbor freight': 'a local hardware store',
            'home depot': 'a hardware store',
            'ikea': 'flat-pack furniture stores'
          }
        },
        {
          regex: /\b(counterfeit|knock[- ]?off|scam|fraud| fraudulent|bootleg|ripoff|rip[- ]off|stole my)\b/gi,
          issue: 'Accuses product of fraud/counterfeit (Amazon blocks these and asks users to file a report instead).',
          suggestion: 'Describe the exact physical flaw or material mismatch objectively (e.g., "feels like thin ABS plastic rather than brushed aluminum").',
          replacements: {
            'counterfeit': 'inconsistent with the listing',
            'knockoff': 'generic version',
            'knock-off': 'generic version',
            'scam': 'disappointing value',
            'ripoff': 'overpriced for what you get',
            'rip-off': 'overpriced for what you get'
          }
        },
        {
          regex: /(https?:\/\/[^\s]+|www\.[^\s]+|\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b)/gi,
          issue: 'Contains a web link, URL, or email address (strictly forbidden by Amazon).',
          suggestion: 'Remove all URLs, domain names, and email addresses.',
          replacements: {}
        }
      ]
    },
    {
      id: 'profanity_weapons_safety',
      severity: 'critical',
      title: 'Profanity or Restricted Safety Trigger Words',
      ruleSummary: 'Profanity, slur words, or certain weapon/explosive keywords cause instant rejection.',
      patterns: [
        {
          regex: /\b(shit|fuck|fucking|bitch|asshole|damn|crap|bastard|bullshit|wtf|pissed)\b/gi,
          issue: 'Contains profanity or borderline language that triggers Amazon’s family-safe filter.',
          suggestion: 'Replace with direct, descriptive language.',
          replacements: {
            'crap': 'poor quality',
            'damn': 'really',
            'pissed': 'frustrated',
            'bullshit': 'misleading'
          }
        }
      ]
    }
  ];

  // Dead-giveaway AI words & robotic patterns that make a review sound fake
  const AI_CLICHE_PATTERNS = [
    { regex: /\b(delve|delving|testament to|game[- ]changer|elevate your|elevates the|realm of|beacon of|tapestry|symphony of|unparalleled|second to none|look no further|exceeded (all )?my expectations|pleasantly surprised by how seamlessly|boasts a|whether you'?re a seasoned pro or|in conclusion|to sum up|all in all, this product|it'?s worth noting that|moreover|furthermore|additionally, the)\b/gi, label: 'AI cliché phrase' },
    { regex: /[—―]/g, label: 'Em-dash (—) punctuation typical of LLM output' }
  ];

  const HUMAN_REPLACEMENTS = {
    'game-changer': 'huge help',
    'game changer': 'real time-saver',
    'exceeded my expectations': 'turned out better than I hoped',
    'exceeded all my expectations': 'worked out much better than I expected',
    'look no further': 'this one is worth checking out',
    'it\'s worth noting that': 'one thing I noticed is',
    'in conclusion': 'bottom line',
    'to sum up': 'overall',
    'moreover': 'also',
    'furthermore': 'on top of that',
    'boasts a': 'has a',
    'unparalleled': 'impressive',
    'second to none': 'really solid'
  };

  /**
   * Perform a full deterministic + heuristic audit of a review draft.
   * @param {Object} params - { title, body, rating, aspects }
   */
  function evaluateReviewDraft({ title = '', body = '', rating = 0, aspects = [] } = {}) {
    const fullText = `${title}\n${body}`.trim();
    const violations = [];
    const aiWarnings = [];

    // 1. Check Amazon Community Guidelines
    for (const category of GUIDELINE_CATEGORIES) {
      for (const pat of category.patterns) {
        const matches = [...fullText.matchAll(pat.regex)];
        for (const m of matches) {
          const matchedWord = m[0];
          const index = m.index || 0;
          const contextStart = Math.max(0, index - 35);
          const contextEnd = Math.min(fullText.length, index + matchedWord.length + 35);
          const snippet = fullText.slice(contextStart, contextEnd).replace(/\s+/g, ' ').trim();
          const lowerMatch = matchedWord.toLowerCase();
          const suggestedReplacement = pat.replacements?.[lowerMatch] !== undefined
            ? pat.replacements[lowerMatch]
            : null;

          violations.push({
            id: `${category.id}_${index}`,
            categoryId: category.id,
            categoryTitle: category.title,
            severity: category.severity,
            matchedText: matchedWord,
            snippet: (contextStart > 0 ? '…' : '') + snippet + (contextEnd < fullText.length ? '…' : ''),
            issue: pat.issue,
            suggestion: pat.suggestion,
            replacement: suggestedReplacement
          });
        }
      }
    }

    // 2. Check AI Clichés & Human Authenticity
    for (const pat of AI_CLICHE_PATTERNS) {
      const matches = [...fullText.matchAll(pat.regex)];
      for (const m of matches) {
        const matchedWord = m[0];
        const lower = matchedWord.toLowerCase();
        aiWarnings.push({
          matchedText: matchedWord,
          label: pat.label,
          replacement: matchedWord === '—' || matchedWord === '―' ? ' - ' : (HUMAN_REPLACEMENTS[lower] || null)
        });
      }
    }

    // 3. Calculate Amazon "Review Insightfulness" & Human Authenticity Metrics
    const words = body.trim() ? body.trim().split(/\s+/) : [];
    const wordCount = words.length;
    const sentences = body.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);

    // Sentence length variance ("burstiness" — humans mix short punchy sentences with longer ones)
    let burstinessScore = 75;
    if (sentences.length >= 3) {
      const lengths = sentences.map(s => s.split(/\s+/).length);
      const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      const variance = lengths.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / lengths.length;
      const stdDev = Math.sqrt(variance);
      burstinessScore = Math.min(100, Math.round(45 + stdDev * 6));
    }

    // Check first-person lived-in signals ("I", "my", "we", "used", "tried", "after", "week", "days", numbers/measurements)
    const firstPersonCount = (body.match(/\b(i|my|me|we|our|i've|i'd|i'm)\b/gi) || []).length;
    const concreteDetailCount = (body.match(/\b(\d+|mm|cm|inch|inches|oz|lbs|grams|hours?|days?|weeks?|months?|minutes?|seconds?|fit|fits|weight|texture|button|cord|battery|wash|cleaned|installed|setup)\b/gi) || []).length;
    const nuanceSignals = (body.match(/\b(however|although|only gripe|minor|wish|downside|one nitpick|keep in mind|heads up|caveat|pro|con|that said|though)\b/gi) || []).length;

    // Guideline Safety Score (100 = completely safe)
    const criticalCount = violations.filter(v => v.severity === 'critical').length;
    const warningCount = violations.filter(v => v.severity === 'warning').length;
    const guidelineScore = Math.max(0, 100 - criticalCount * 30 - warningCount * 15);

    // Human Authenticity Score
    const aiPenalty = aiWarnings.length * 10;
    const firstPersonBonus = Math.min(20, firstPersonCount * 3);
    const detailBonus = Math.min(20, concreteDetailCount * 3);
    const nuanceBonus = Math.min(10, nuanceSignals * 5);
    const humanScore = wordCount < 10
      ? 0
      : Math.max(15, Math.min(100, Math.round(50 + firstPersonBonus + detailBonus + nuanceBonus + (burstinessScore - 65) * 0.3 - aiPenalty)));

    // Insightfulness Level (Amazon's 4-segment bar: Poor=1, Fair=2, Good=3, Excellent=4)
    let insightfulnessLevel = 1;
    let insightfulnessLabel = 'Needs Detail';
    if (wordCount >= 90 && concreteDetailCount >= 3 && firstPersonCount >= 2 && nuanceSignals >= 1) {
      insightfulnessLevel = 4;
      insightfulnessLabel = 'Excellent';
    } else if (wordCount >= 55 && (concreteDetailCount >= 2 || firstPersonCount >= 2)) {
      insightfulnessLevel = 3;
      insightfulnessLabel = 'Strong';
    } else if (wordCount >= 25) {
      insightfulnessLevel = 2;
      insightfulnessLabel = 'Good';
    }

    // Build constructive strengths & suggestions (like SmartViner's ReviewQuality + enhanced)
    const strengths = [];
    const suggestions = [];

    if (firstPersonCount >= 2) strengths.push('Uses authentic first-person ("I / my") hands-on perspective');
    else if (wordCount > 0) suggestions.push({
      quote: '',
      issue: 'Lacks first-person ownership ("I used", "In my kitchen").',
      question: 'How and where did you personally test or use this item?'
    });

    if (concreteDetailCount >= 3) strengths.push('Includes specific measurements, time tested, or physical observations');
    else if (wordCount > 0) suggestions.push({
      quote: '',
      issue: 'Could use more concrete physical details or duration of use.',
      question: 'How long did you test it, and how does the build/size/material feel in hand?'
    });

    if (nuanceSignals >= 1) strengths.push('Balanced perspective with realistic pros/cons or caveats for shoppers');
    else if (wordCount > 20 && rating >= 4) suggestions.push({
      quote: '',
      issue: 'Reads slightly one-sided without any small caveat or "who this is best for" nuance.',
      question: 'Was there any minor quirk, setup tip, or type of buyer this wouldn’t fit?'
    });

    if (violations.length === 0 && wordCount > 15) {
      strengths.push('100% clear of Amazon Community Guideline rejection triggers');
    }

    return {
      guidelineScore,
      humanScore,
      insightfulnessLevel,
      insightfulnessLabel,
      wordCount,
      violations,
      aiWarnings,
      strengths,
      suggestions,
      isSafeToSubmit: criticalCount === 0 && warningCount === 0
    };
  }

  /**
   * Auto-fix deterministic guideline violations and AI clichés in text
   */
  function autoFixText(text = '') {
    let updated = String(text);
    // Replace em-dashes with standard hyphens
    updated = updated.replace(/\s*[—―‒–]\s*/g, ' - ');

    // Apply known safe replacements from guideline patterns
    for (const category of GUIDELINE_CATEGORIES) {
      for (const pat of category.patterns) {
        if (!pat.replacements) continue;
        for (const [bad, good] of Object.entries(pat.replacements)) {
          const rx = new RegExp(`\\b${bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
          updated = updated.replace(rx, (match) => {
            if (!good) return '';
            // Preserve capitalization of first letter
            if (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) {
              return good.charAt(0).toUpperCase() + good.slice(1);
            }
            return good;
          });
        }
      }
    }

    // Apply human replacements for AI clichés
    for (const [cliche, natural] of Object.entries(HUMAN_REPLACEMENTS)) {
      const rx = new RegExp(`\\b${cliche.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      updated = updated.replace(rx, (match) => {
        if (match[0] === match[0].toUpperCase()) {
          return natural.charAt(0).toUpperCase() + natural.slice(1);
        }
        return natural;
      });
    }

    return updated.replace(/  +/g, ' ').trim();
  }

  const API = {
    GUIDELINE_CATEGORIES,
    evaluateReviewDraft,
    autoFixText
  };

  root.VinePilotGuidelines = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
