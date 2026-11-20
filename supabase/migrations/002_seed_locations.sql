-- 002_seed_locations.sql
-- All 64 districts. Upazilas are seeded ONLY for these 10 demo districts:
-- Dhaka, Gazipur, Narsingdi, Cumilla, Chattogram, Rajshahi, Bogura, Rangpur, Dinajpur, Jashore.
-- TODO (later migration): upazilas of the other 54 districts.
-- NOTE: Dhaka city areas are "thanas", not upazilas. Only the 5 rural upazilas of Dhaka district are here.

INSERT INTO districts (id, name_en, name_bn) VALUES
 (1,'Dhaka','ঢাকা'),(2,'Gazipur','গাজীপুর'),(3,'Kishoreganj','কিশোরগঞ্জ'),(4,'Manikganj','মানিকগঞ্জ'),
 (5,'Munshiganj','মুন্সীগঞ্জ'),(6,'Narayanganj','নারায়ণগঞ্জ'),(7,'Narsingdi','নরসিংদী'),(8,'Tangail','টাঙ্গাইল'),
 (9,'Faridpur','ফরিদপুর'),(10,'Gopalganj','গোপালগঞ্জ'),(11,'Madaripur','মাদারীপুর'),(12,'Rajbari','রাজবাড়ী'),
 (13,'Shariatpur','শরীয়তপুর'),
 (14,'Chattogram','চট্টগ্রাম'),(15,'Cox''s Bazar','কক্সবাজার'),(16,'Cumilla','কুমিল্লা'),
 (17,'Brahmanbaria','ব্রাহ্মণবাড়িয়া'),(18,'Chandpur','চাঁদপুর'),(19,'Lakshmipur','লক্ষ্মীপুর'),
 (20,'Noakhali','নোয়াখালী'),(21,'Feni','ফেনী'),(22,'Khagrachhari','খাগড়াছড়ি'),(23,'Rangamati','রাঙ্গামাটি'),
 (24,'Bandarban','বান্দরবান'),
 (25,'Rajshahi','রাজশাহী'),(26,'Bogura','বগুড়া'),(27,'Joypurhat','জয়পুরহাট'),(28,'Naogaon','নওগাঁ'),
 (29,'Natore','নাটোর'),(30,'Chapainawabganj','চাঁপাইনবাবগঞ্জ'),(31,'Pabna','পাবনা'),(32,'Sirajganj','সিরাজগঞ্জ'),
 (33,'Khulna','খুলনা'),(34,'Bagerhat','বাগেরহাট'),(35,'Chuadanga','চুয়াডাঙ্গা'),(36,'Jashore','যশোর'),
 (37,'Jhenaidah','ঝিনাইদহ'),(38,'Kushtia','কুষ্টিয়া'),(39,'Magura','মাগুরা'),(40,'Meherpur','মেহেরপুর'),
 (41,'Narail','নড়াইল'),(42,'Satkhira','সাতক্ষীরা'),
 (43,'Barishal','বরিশাল'),(44,'Barguna','বরগুনা'),(45,'Bhola','ভোলা'),(46,'Jhalokathi','ঝালকাঠি'),
 (47,'Patuakhali','পটুয়াখালী'),(48,'Pirojpur','পিরোজপুর'),
 (49,'Sylhet','সিলেট'),(50,'Habiganj','হবিগঞ্জ'),(51,'Moulvibazar','মৌলভীবাজার'),(52,'Sunamganj','সুনামগঞ্জ'),
 (53,'Rangpur','রংপুর'),(54,'Dinajpur','দিনাজপুর'),(55,'Gaibandha','গাইবান্ধা'),(56,'Kurigram','কুড়িগ্রাম'),
 (57,'Lalmonirhat','লালমনিরহাট'),(58,'Nilphamari','নীলফামারী'),(59,'Panchagarh','পঞ্চগড়'),(60,'Thakurgaon','ঠাকুরগাঁও'),
 (61,'Mymensingh','ময়মনসিংহ'),(62,'Jamalpur','জামালপুর'),(63,'Netrokona','নেত্রকোণা'),(64,'Sherpur','শেরপুর');

INSERT INTO upazilas (district_id, name_en, name_bn)
SELECT d.id, v.en, v.bn
FROM (VALUES
 ('Dhaka','Dhamrai','ধামরাই'),('Dhaka','Dohar','দোহার'),('Dhaka','Keraniganj','কেরানীগঞ্জ'),
 ('Dhaka','Nawabganj','নবাবগঞ্জ'),('Dhaka','Savar','সাভার'),

 ('Gazipur','Gazipur Sadar','গাজীপুর সদর'),('Gazipur','Kaliakair','কালিয়াকৈর'),('Gazipur','Kaliganj','কালীগঞ্জ'),
 ('Gazipur','Kapasia','কাপাসিয়া'),('Gazipur','Sreepur','শ্রীপুর'),

 ('Narsingdi','Belabo','বেলাবো'),('Narsingdi','Monohardi','মনোহরদী'),('Narsingdi','Narsingdi Sadar','নরসিংদী সদর'),
 ('Narsingdi','Palash','পলাশ'),('Narsingdi','Raipura','রায়পুরা'),('Narsingdi','Shibpur','শিবপুর'),

 ('Cumilla','Barura','বরুড়া'),('Cumilla','Brahmanpara','ব্রাহ্মণপাড়া'),('Cumilla','Burichang','বুড়িচং'),
 ('Cumilla','Chandina','চান্দিনা'),('Cumilla','Chauddagram','চৌদ্দগ্রাম'),('Cumilla','Daudkandi','দাউদকান্দি'),
 ('Cumilla','Debidwar','দেবিদ্বার'),('Cumilla','Homna','হোমনা'),('Cumilla','Laksam','লাকসাম'),
 ('Cumilla','Muradnagar','মুরাদনগর'),('Cumilla','Nangalkot','নাঙ্গলকোট'),('Cumilla','Cumilla Adarsha Sadar','কুমিল্লা আদর্শ সদর'),
 ('Cumilla','Meghna','মেঘনা'),('Cumilla','Monohargonj','মনোহরগঞ্জ'),('Cumilla','Sadar Dakshin','সদর দক্ষিণ'),
 ('Cumilla','Titas','তিতাস'),

 ('Chattogram','Anwara','আনোয়ারা'),('Chattogram','Banshkhali','বাঁশখালী'),('Chattogram','Boalkhali','বোয়ালখালী'),
 ('Chattogram','Chandanaish','চন্দনাইশ'),('Chattogram','Fatikchhari','ফটিকছড়ি'),('Chattogram','Hathazari','হাটহাজারী'),
 ('Chattogram','Lohagara','লোহাগাড়া'),('Chattogram','Mirsharai','মীরসরাই'),('Chattogram','Patiya','পটিয়া'),
 ('Chattogram','Rangunia','রাঙ্গুনিয়া'),('Chattogram','Raozan','রাউজান'),('Chattogram','Sandwip','সন্দ্বীপ'),
 ('Chattogram','Satkania','সাতকানিয়া'),('Chattogram','Sitakunda','সীতাকুণ্ড'),

 ('Rajshahi','Bagha','বাঘা'),('Rajshahi','Bagmara','বাগমারা'),('Rajshahi','Charghat','চারঘাট'),
 ('Rajshahi','Durgapur','দুর্গাপুর'),('Rajshahi','Godagari','গোদাগাড়ী'),('Rajshahi','Mohanpur','মোহনপুর'),
 ('Rajshahi','Paba','পবা'),('Rajshahi','Puthia','পুঠিয়া'),('Rajshahi','Tanore','তানোর'),

 ('Bogura','Adamdighi','আদমদিঘী'),('Bogura','Bogura Sadar','বগুড়া সদর'),('Bogura','Dhunat','ধুনট'),
 ('Bogura','Dhupchanchia','দুপচাঁচিয়া'),('Bogura','Gabtali','গাবতলী'),('Bogura','Kahaloo','কাহালু'),
 ('Bogura','Nandigram','নন্দীগ্রাম'),('Bogura','Sariakandi','সারিয়াকান্দি'),('Bogura','Shajahanpur','শাজাহানপুর'),
 ('Bogura','Sherpur','শেরপুর'),('Bogura','Shibganj','শিবগঞ্জ'),('Bogura','Sonatola','সোনাতলা'),

 ('Rangpur','Badarganj','বদরগঞ্জ'),('Rangpur','Gangachara','গঙ্গাচড়া'),('Rangpur','Kaunia','কাউনিয়া'),
 ('Rangpur','Mithapukur','মিঠাপুকুর'),('Rangpur','Pirgachha','পীরগাছা'),('Rangpur','Pirganj','পীরগঞ্জ'),
 ('Rangpur','Rangpur Sadar','রংপুর সদর'),('Rangpur','Taraganj','তারাগঞ্জ'),

 ('Dinajpur','Birampur','বিরামপুর'),('Dinajpur','Birganj','বীরগঞ্জ'),('Dinajpur','Biral','বিরল'),
 ('Dinajpur','Bochaganj','বোচাগঞ্জ'),('Dinajpur','Chirirbandar','চিরিরবন্দর'),('Dinajpur','Phulbari','ফুলবাড়ী'),
 ('Dinajpur','Ghoraghat','ঘোড়াঘাট'),('Dinajpur','Hakimpur','হাকিমপুর'),('Dinajpur','Kaharole','কাহারোল'),
 ('Dinajpur','Khansama','খানসামা'),('Dinajpur','Dinajpur Sadar','দিনাজপুর সদর'),('Dinajpur','Nawabganj','নবাবগঞ্জ'),
 ('Dinajpur','Parbatipur','পার্বতীপুর'),

 ('Jashore','Abhaynagar','অভয়নগর'),('Jashore','Bagherpara','বাঘারপাড়া'),('Jashore','Chaugachha','চৌগাছা'),
 ('Jashore','Jhikargachha','ঝিকরগাছা'),('Jashore','Keshabpur','কেশবপুর'),('Jashore','Jashore Sadar','যশোর সদর'),
 ('Jashore','Manirampur','মণিরামপুর'),('Jashore','Sharsha','শার্শা')
) AS v(dname, en, bn)
JOIN districts d ON d.name_en = v.dname;
