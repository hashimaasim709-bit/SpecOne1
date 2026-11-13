// Estimate a vehicle's size class and silhouette from its make/model description.
import type { Body, Size } from './constants';

const LARGE = /range rover|discovery|defender|x5|x6|x7|q7|q8|touareg|cayenne|transit|sprinter|vito|crafter|transporter|trafic|vivaro|ducato|boxer|relay|master|movano|land cruiser|xc90|gle|gls|g-class|ranger|hilux|navara|l200|amarok|sorento|santa fe|kodiaq|tarraco/i;
const SMALL = /fiesta|polo|corsa|mini|ibiza|fabia|yaris|clio|208|108|c1|aygo|i10|i20|picanto|rio|micra|up!|\bup\b|500|panda|swift|jazz|sandero|twingo|mii|citigo|adam|ka\b/i;
const VAN = /transit|sprinter|vito|crafter|transporter|trafic|vivaro|ducato|boxer|relay|master|movano|berlingo|partner|combo|caddy|kangoo|dispatch|expert|proace|nv200|nv300|daily/i;
const SUV = /range rover|discovery|defender|evoque|velar|x[1-7]\b|q[2-8]\b|touareg|tiguan|t-roc|cayenne|macan|kuga|puma|ecosport|qashqai|juke|x-trail|sportage|sorento|tucson|santa fe|kodiaq|karoq|ateca|tarraco|xc40|xc60|xc90|gla|glb|glc|gle|gls|f-pace|e-pace|3008|5008|2008|captur|kadjar|duster|cr-v|hr-v|rav4|c-hr|cx-5|cx-30|outlander|model y|model x/i;
const SALOON = /3 series|5 series|7 series|c-class|e-class|s-class|a4|a6|a8|passat|mondeo|insignia|octavia|superb|model 3|model s|xe|xf|xj|is\b|es\b|giulia|s60|s90|arteon|i4|\bcla\b|cls/i;

export function classifyVehicle(description: string): { size: Size; body: Body } {
  const d = description.toLowerCase();
  const body: Body = VAN.test(d) ? 'van' : SUV.test(d) ? 'suv' : SALOON.test(d) ? 'saloon' : 'hatchback';
  const size: Size = LARGE.test(d) ? 'L' : SMALL.test(d) ? 'S' : 'M';
  return { size, body };
}

