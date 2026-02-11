import { Mountain, Camera, Calendar, ShoppingBag, Share2, X, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';

function App() {
  const [showShareModal, setShowShareModal] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-fade-in-up');
          }
        });
      },
      { threshold: 0.1 }
    );

    document.querySelectorAll('.observe-scroll').forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <img src="/assets/b0478ce9125b0eeafe32cd61185e870a_11zon.jpg" alt="Plose Logo" className="h-20 w-auto" />
            </div>

            <nav className="hidden md:flex items-center space-x-6">
              <a href="#" className="text-gray-700 hover:text-[#9B8B3E] transition font-medium">SOMMER</a>
              <a href="#" className="text-gray-700 hover:text-[#9B8B3E] transition font-medium">WINTER</a>
              <a href="#" className="text-gray-700 hover:text-[#9B8B3E] transition font-medium">ÖFFNUNGSZEITEN & PREISE</a>
              <a href="#" className="text-gray-700 hover:text-[#9B8B3E] transition font-medium">HOTELS</a>
              <a href="#" className="text-gray-700 hover:text-[#9B8B3E] transition font-medium">JOBS</a>
              <button className="flex items-center space-x-2 bg-[#9B8B3E] text-white px-4 py-2 hover:bg-[#8A7A35] transition">
                <Camera className="h-4 w-4" />
                <span className="text-sm font-medium">Fotos kaufen</span>
              </button>
            </nav>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="/assets/plose-kasse-fotos.webp"
            alt="Plose Background"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black opacity-40"></div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 relative z-10">
          <div className="flex flex-col md:flex-row items-center justify-center gap-8">
            <div className="text-center md:text-left">
              <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">Plosebob Erinnerungen</h1>
              <p className="text-xl md:text-2xl text-white mb-8 max-w-3xl">Finde dein persönliches Erinnerungsfoto vom Plosebob-Erlebnis</p>
              <a href="#calendar" className="inline-flex items-center space-x-2 bg-[#9B8B3E] text-white px-8 py-4 text-lg font-medium hover:bg-[#8A7A35] transition shadow-lg hover:shadow-xl">
                <span>Jetzt Foto ansehen</span>
                <Camera className="h-5 w-5" />
              </a>
            </div>
            <div className="border-2 border-white p-2">
              <img src="/assets/Plosebob_Plosebob_Argento-Artistry.png.webp" alt="Plosebob" className="w-48 h-48 md:w-64 md:h-64 object-contain border-2 border-white p-2" />
            </div>
          </div>

          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce-smooth">
            <div className="flex flex-col items-center">
              <ChevronDown className="h-8 w-8 text-white" strokeWidth={3} />
              <ChevronDown className="h-8 w-8 text-white -mt-4" strokeWidth={3} />
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <svg className="absolute bottom-0 w-full h-full" viewBox="0 0 1440 800" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice">
            <path d="M0,400 L200,350 L400,380 L600,280 L800,320 L1000,250 L1200,300 L1440,280 L1440,800 L0,800 Z" fill="#D1D5DB" opacity="0.5"/>
            <path d="M0,500 L150,480 L300,450 L500,420 L700,460 L900,400 L1100,440 L1300,420 L1440,450 L1440,800 L0,800 Z" fill="#D1D5DB" opacity="0.3"/>
          </svg>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16 observe-scroll opacity-0">
            <h2 className="text-4xl font-bold text-gray-800 mb-4">So einfach geht's</h2>
            <p className="text-lg text-gray-600">In nur drei Schritten zu deinem persönlichen Erinnerungsfoto</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="observe-scroll opacity-0 text-center p-8 bg-gray-100 hover:shadow-lg transition-shadow duration-300">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-[#9B8B3E] text-white rounded-full mb-6">
                <Calendar className="h-8 w-8" />
              </div>
              <h3 className="text-2xl font-bold text-gray-800 mb-4">1. Foto finden</h3>
              <p className="text-gray-600">Wähle dein Fahrtdatum im Kalender</p>
            </div>

            <div className="observe-scroll opacity-0 text-center p-8 bg-[#1E3A5F] hover:shadow-lg transition-shadow duration-300" style={{ transitionDelay: '100ms' }}>
              <div className="inline-flex items-center justify-center w-16 h-16 bg-[#9B8B3E] text-white rounded-full mb-6">
                <Camera className="h-8 w-8" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">2. Bild auswählen</h3>
              <p className="text-gray-200">Suche dein persönliches Foto</p>
            </div>

            <div className="observe-scroll opacity-0 text-center p-8 bg-gray-100 hover:shadow-lg transition-shadow duration-300" style={{ transitionDelay: '200ms' }}>
              <div className="inline-flex items-center justify-center w-16 h-16 bg-[#9B8B3E] text-white rounded-full mb-6">
                <ShoppingBag className="h-8 w-8" />
              </div>
              <h3 className="text-2xl font-bold text-gray-800 mb-4">3. Kaufen und teilen</h3>
              <p className="text-gray-600">Kaufe es digital und teile den Moment</p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative bg-white overflow-hidden" style={{ height: '200px' }}>
        <svg className="absolute bottom-0 w-full h-full" viewBox="0 0 1440 200" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
          <path d="M0,200 L0,150 L300,120 L500,80 L650,100 L800,60 L950,90 L1100,70 L1300,110 L1440,90 L1440,200 Z" fill="#D1D5DB" opacity="0.5"/>
        </svg>
      </section>

      <section className="bg-[#9B8B3E] py-4 overflow-hidden">
        <div className="whitespace-nowrap">
          <div className="inline-block animate-scroll">
            <span className="text-white text-xl font-bold mx-8">DIE KABINENBAHN PLOSE SCHLIESST UM 17:00 UHR</span>
            <span className="text-white text-xl font-bold mx-8">DIE KABINENBAHN PLOSE SCHLIESST UM 17:00 UHR</span>
            <span className="text-white text-xl font-bold mx-8">DIE KABINENBAHN PLOSE SCHLIESST UM 17:00 UHR</span>
            <span className="text-white text-xl font-bold mx-8">DIE KABINENBAHN PLOSE SCHLIESST UM 17:00 UHR</span>
            <span className="text-white text-xl font-bold mx-8">DIE KABINENBAHN PLOSE SCHLIESST UM 17:00 UHR</span>
            <span className="text-white text-xl font-bold mx-8">DIE KABINENBAHN PLOSE SCHLIESST UM 17:00 UHR</span>
          </div>
        </div>
      </section>

      <section id="calendar" className="py-20 bg-gradient-to-b from-slate-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 observe-scroll opacity-0">
            <h2 className="text-4xl font-bold text-gray-800 mb-6">Bildkalender</h2>
            <p className="text-lg text-gray-600 max-w-3xl mx-auto mb-8">
              Direkt nach der Fahrt kannst du hier dein Onride-Foto finden und kaufen. Einfach durch den Kalender klicken, dein Bild auswählen und digital erwerben. Die Fotos werden täglich automatisch hochgeladen – sortiert nach Datum. Alle Bilder werden <strong className="font-bold">datenschutzkonform</strong> verarbeitet und gespeichert.
            </p>
          </div>

          <div className="observe-scroll opacity-0 relative">
            <div className="relative w-full" style={{ height: '880px' }}>
              <img
                src="/assets/plose223.jpg"
                alt="Plosebob"
                className="w-full h-full object-cover"
              />
              <img
                src="/assets/dem.png"
                alt="Frame"
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ objectFit: 'fill' }}
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
              <a
                href="http://www2.liftpictures.de/jpeg4web/calendar/index.php?attr=1366"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#9B8B3E] text-white font-semibold hover:bg-[#8A7A35] transition-colors duration-200 shadow-lg hover:shadow-xl clip-corner"
              >
                <Calendar className="h-5 w-5" />
                Zum Fotokalender
              </a>

              <button
                onClick={() => setShowShareModal(true)}
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-gray-800 font-semibold border-2 border-[#9B8B3E] hover:bg-gray-50 transition-colors duration-200 shadow-lg hover:shadow-xl clip-corner"
              >
                <Share2 className="h-5 w-5" />
                Teilen
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="relative bg-gradient-to-b from-white to-gray-50 overflow-hidden" style={{ height: '250px' }}>
        <svg className="absolute bottom-0 w-full h-full" viewBox="0 0 1440 250" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
          <path d="M0,250 L0,170 L250,130 L450,90 L600,110 L750,70 L900,100 L1050,80 L1200,120 L1440,95 L1440,250 Z" fill="#D1D5DB" opacity="0.5"/>
        </svg>
      </section>

      {showShareModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={() => setShowShareModal(false)}>
          <div className="bg-white rounded-lg max-w-md w-full p-8 relative clip-corner" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowShareModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-6 w-6" />
            </button>

            <div className="text-center">
              <Share2 className="h-12 w-12 text-[#9B8B3E] mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-gray-800 mb-4">Teile dein Erlebnis!</h3>
              <p className="text-gray-600 mb-6">
                Teile deine Plosebob-Fotos auf Social Media und tagge uns!
              </p>
              <div className="bg-[#9B8B3E] bg-opacity-10 p-4 rounded-lg mb-6">
                <p className="text-sm text-gray-700 font-semibold mb-2">
                  📸 Folge uns und nehme am Gewinnspiel teil für eine freie Fahrt!
                </p>
                <p className="text-xs text-gray-600">
                  Markiere uns in deinen Posts für die Chance zu gewinnen
                </p>
              </div>
              <button
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: 'Plosebob Onride-Fotos',
                      text: 'Schau dir die Plosebob Onride-Fotos an!',
                      url: window.location.href
                    }).catch(() => {});
                  } else {
                    navigator.clipboard.writeText(window.location.href);
                    alert('Link wurde in die Zwischenablage kopiert!');
                  }
                  setShowShareModal(false);
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#9B8B3E] text-white font-semibold hover:bg-[#8A7A35] transition-colors duration-200 shadow-lg hover:shadow-xl clip-corner"
              >
                <Share2 className="h-5 w-5" />
                Jetzt teilen
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="py-16 bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
            <p className="text-gray-600 text-center md:text-left">
              Dieses System wird in Kooperation mit <span className="font-semibold">Liftpictures Fotosysteme</span> realisiert – Spezialist für Fotoanlagen an Freizeitattraktionen.
            </p>
            <div className="flex items-center">
              <img
                src="/assets/Liftpicutures Logo alt.jpg"
                alt="Liftpictures Logo"
                className="h-16 object-contain"
              />
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-slate-800 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <h4 className="font-bold text-lg mb-4">Navigation</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-300 hover:text-white transition">Sommer</a></li>
                <li><a href="#" className="text-gray-300 hover:text-white transition">Winter</a></li>
                <li><a href="#" className="text-gray-300 hover:text-white transition">Öffnungszeiten & Preise</a></li>
                <li><a href="#" className="text-gray-300 hover:text-white transition">Hotels</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-lg mb-4">Service</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-300 hover:text-white transition">Kontakt</a></li>
                <li><a href="#" className="text-gray-300 hover:text-white transition">Jobs</a></li>
                <li><a href="#" className="text-gray-300 hover:text-white transition">Presse</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-lg mb-4">Rechtliches</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-300 hover:text-white transition">Impressum</a></li>
                <li><a href="#" className="text-gray-300 hover:text-white transition">Datenschutz</a></li>
                <li><a href="#" className="text-gray-300 hover:text-white transition">AGB</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-lg mb-4">Partner</h4>
              <ul className="space-y-2">
                <li>
                  <a href="https://www.liftpictures.de" target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-white transition flex items-center space-x-2">
                    <Camera className="h-4 w-4" />
                    <span>Technikpartner: Liftpictures</span>
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-700 pt-8 text-center text-gray-400">
            <p>&copy; 2025 Plose AG. Alle Rechte vorbehalten.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
