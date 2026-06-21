// ASCII-art banners shown above the welcome text on the Help tab. One is
// picked at random each time the page loads

export const BANNERS = [
  `
    iLE88Dj.  :jD88888Dj:
.LGitE888D.f8GjjjL8888E;
iE   :8888Et.     .G8888.	888       888 8888888888 888888b.  
;i    E888,        ,8888,	888   o   888 888        888  "88b 
      D888,        :8888:	888  d8b  888 888        888  .88P 
      D888,        :8888:	888 d888b 888 8888888    8888888K. 
      D888,        :8888:	888d88888b888 888        888  "Y88b 
      D888,        :8888:	88888P Y88888 888        888    888 
      888W,        :8888:	8888P   Y8888 888        888   d88P 
      W88W,        :8888:	888P     Y888 8888888888 8888888P"
      W88W,	       :8888:
      W88W:        :8888:      88888b.   8888b.  88888b.   .d88b.
      DGGD:        :8888:      888 "88b     "88b 888 "88b d88""88b
                   :8888:      888  888 .d888888 888  888 888  888
                   :W888:      888  888 888  888 888  888 Y88..88P
                   :8888:      888  888 "Y888888 888  888  "Y88P"
                    E888i
                    tW88D             Web Text Editor
  `,
                
];

export function randomBanner() {
  return BANNERS[Math.floor(Math.random() * BANNERS.length)];
}
