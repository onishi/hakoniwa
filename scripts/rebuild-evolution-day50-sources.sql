-- Replace raw drops with named sources. The source remains in the world while
-- the resulting item goes to the observer's inventory and gets a use.
UPDATE world_entities SET gone_day = born_day WHERE kind = 'item' AND gone_day IS NULL;

INSERT OR IGNORE INTO world_entities (entity_key, kind, x, y, width, height, sprite, label, message, panel, flat, blocks, born_day) VALUES
 ('source-fruit-tree','source',4,3,1,1,'map-tree','実のなる果樹','実りを採って、庭へ植えられます。',NULL,0,1,20),
 ('source-tool-shed','source',10,2,1,1,'map-house','道具小屋','道具を一つ、持ち出せます。',NULL,0,1,32),
 ('source-reed-bed','source',11,2,1,1,'map-branch','葦の群生','細い葦を採れます。',NULL,0,0,21),
 ('source-clay-pit','source',12,2,1,1,'map-stone','赤土の窪地','赤土を採れます。',NULL,0,0,22),
 ('source-conifer','source',13,2,1,1,'map-tree','松の若木','松ぼっくりを採れます。',NULL,0,1,23),
 ('source-root-bed','source',14,2,1,1,'map-tree','根の露出した土','細い根を採れます。',NULL,0,0,24),
 ('source-bark-tree','source',11,4,1,1,'map-tree','樹皮の木','樹皮を採れます。',NULL,0,1,25),
 ('source-seedling','source',12,4,1,1,'map-flower','苗床','小さな苗を採れます。',NULL,0,0,26),
 ('source-lichen-rock','source',13,4,1,1,'map-stone','地衣類の石','地衣類を採れます。',NULL,0,0,27),
 ('source-wildflower','source',14,4,1,1,'map-flower','野の花畑','野の花を採れます。',NULL,0,0,28),
 ('source-lateberry','source',16,8,1,1,'map-tree','遅い実の木','遅い実を採れます。',NULL,0,1,48),
 ('source-sandbank','source',13,8,1,1,'map-stone','白砂の岸','白い砂を採れます。',NULL,0,0,29),
 ('source-mirror-stone','source',15,10,1,1,'map-stone','鏡石の地面','鏡石を採れます。',NULL,0,0,49),
 ('source-windplant','source',16,10,1,1,'map-flower','風の草むら','風の種を採れます。',NULL,0,0,50),
 ('source-seed-pod','source',4,9,1,1,'map-tree','種のなる草','植えられる種を採れます。',NULL,0,0,14);
