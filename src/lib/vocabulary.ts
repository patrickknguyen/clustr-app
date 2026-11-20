// Curated subject vocabulary: the words a designer would actually write on a moodboard.
// It replaced the 400 most frequent Unsplash keywords (unsplash-vocabulary.ts), which leaned
// on nature and category jargon like "leisure activities", "apparel" and "geographical
// feature". Words are grouped by theme for editing only; the app treats them as one flat
// list. Each is embedded as "a photo of {word}". After editing, re-embed with
// npm run build:vocab-vectors.

export const LABEL_TEMPLATE = (word: string) => `a photo of ${word}`;

const PEOPLE = [
  'people', 'crowd', 'portrait', 'face', 'hands', 'friends', 'couple', 'family', 'child',
  'conversation', 'audience', 'speaker', 'musician', 'band', 'dancer', 'performer', 'model',
  'selfie', 'laughter', 'handshake', 'silhouette', 'street style',
];

const GATHERINGS = [
  'party', 'art gallery', 'exhibition', 'museum', 'concert', 'stage', 'presentation',
  'workshop', 'meetup', 'dinner party', 'wine bar', 'celebration', 'festival', 'market',
  'nightlife', 'dance floor', 'live music', 'opening night', 'queue', 'toast',
];

const FOOD_AND_DRINK = [
  'wine', 'wine glass', 'cocktail', 'beer', 'coffee', 'tea', 'dessert', 'cake', 'pastry',
  'bread', 'cheese board', 'appetizers', 'sushi', 'pizza', 'noodles', 'salad', 'fruit',
  'vegetables', 'breakfast', 'restaurant', 'cafe', 'bar counter', 'table setting', 'picnic',
  'ice cream', 'bottles',
];

const INTERIORS = [
  'interior', 'living room', 'bedroom', 'kitchen', 'bathroom', 'office', 'workspace', 'desk',
  'studio', 'lobby', 'hallway', 'staircase', 'window', 'doorway', 'ceiling', 'shelves',
  'bookshelf', 'sofa', 'chair', 'table', 'lamp', 'pendant light', 'chandelier', 'rug',
  'curtains', 'bed', 'mirror', 'houseplant', 'fireplace', 'tiled floor', 'gallery wall',
 
];

const ARCHITECTURE_AND_CITY = [
  'architecture', 'building', 'skyscraper', 'facade', 'house', 'cabin', 'bridge', 'street',
  'alley', 'city', 'skyline', 'rooftop', 'storefront', 'signage', 'neon sign', 'subway',
  'train', 'car', 'bicycle', 'crosswalk', 'tunnel', 'columns', 'arches', 'dome', 'courtyard',
  'balcony', 'ruins', 'church', 'temple', 'pool', 'warehouse',
  'construction site', 'suburb', 'apartment building',
];

const DESIGN_AND_MEDIA = [
  'poster', 'typography', 'lettering', 'logo', 'book', 'magazine', 'print', 'illustration',
  'painting', 'drawing', 'sketch', 'collage', 'sculpture', 'art installation', 'photograph',
  'mural', 'graffiti', 'screen', 'laptop', 'phone', 'user interface', 'website', 'diagram',
  'chart', 'map', 'packaging', 'label', 'business card', 'stickers', 'notebook', 'paper',
  'pen', 'product', 'color swatches', 'fabric swatches', 'moodboard',
  'whiteboard', 'projector screen', 'zine', 'vinyl record',
];

const OBJECTS = [
  'ceramics', 'vase', 'bowl', 'cup', 'mug', 'plate', 'glassware', 'candle', 'clock',
  'camera', 'headphones', 'keyboard', 'record player', 'guitar', 'piano', 'watch', 'jewelry',
  'sunglasses', 'bag', 'shoes', 'sneakers', 'hat', 'jacket', 'dress', 'shirt', 'fashion',
  'clothing rack', 'furniture', 'toy', 'tools', 'bouquet', 'basket', 'perfume', 'cosmetics',
  'skincare', 'umbrella',
];

const MATERIALS = [
  'wood', 'metal', 'glass', 'concrete', 'stone', 'marble', 'brick', 'tiles', 'fabric',
  'linen', 'leather', 'plastic', 'clay', 'paint', 'water', 'smoke', 'light', 'shadow',
  'reflection', 'neon light', 'candlelight', 'chrome', 'velvet', 'terrazzo', 'rattan',
];

const NATURE = [
  'nature', 'landscape', 'mountains', 'ocean', 'beach', 'lake', 'river', 'forest', 'tree',
  'flowers', 'plants', 'leaves', 'grass', 'field', 'desert', 'sky', 'clouds', 'sunset',
  'sunrise', 'snow', 'rain', 'garden', 'park', 'rocks', 'sand', 'waves', 'island', 'animal',
  'dog', 'cat', 'bird', 'horse', 'fish', 'insect', 'moon', 'stars', 'night sky', 'fog',
  'palm trees', 'cactus', 'succulents', 'mushrooms', 'coral reef', 'waterfall',
];

const TIME_AND_PLACE = [
  'night', 'evening', 'daylight', 'sunlight', 'summer', 'winter', 'autumn', 'spring',
  'vacation', 'travel', 'road trip', 'airport', 'airplane', 'boat', 'harbor', 'highway',
  'countryside', 'small town',
];

const ACTIVITIES = [
  'sport', 'running', 'yoga', 'skateboarding', 'surfing', 'hiking', 'swimming', 'dancing',
  'cooking', 'working', 'reading', 'drinking', 'eating', 'shopping', 'playing music',
  'taking a photo', 'cycling', 'gym',
];

const PATTERNS_AND_FORMS = [
  'pattern', 'texture', 'stripes', 'grid', 'circles', 'curves', 'lines', 'abstract shapes',
  'gradient', 'color blocks', 'symmetry', 'repetition', 'blur', 'bokeh', 'lens flare',
];

export const VOCABULARY: string[] = [
  ...new Set([
    ...PEOPLE,
    ...GATHERINGS,
    ...FOOD_AND_DRINK,
    ...INTERIORS,
    ...ARCHITECTURE_AND_CITY,
    ...DESIGN_AND_MEDIA,
    ...OBJECTS,
    ...MATERIALS,
    ...NATURE,
    ...TIME_AND_PLACE,
    ...ACTIVITIES,
    ...PATTERNS_AND_FORMS,
  ]),
];
