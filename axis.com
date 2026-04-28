<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AXIS | Espin Medical</title>

<style>
body{
  margin:0;
  font-family:Arial, Helvetica, sans-serif;
  background:#f8fafc;
  color:#0f172a;
}

.wrap{
  max-width:1100px;
  margin:auto;
  padding:60px 20px;
}

.hero{text-align:center;margin-bottom:40px;}
.hero h1{font-size:2.5em;margin-bottom:10px;}
.hero p{color:#475569;font-size:1.1em;}

.steps{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(260px,1fr));
  gap:25px;
}

.step{
  background:#fff;
  border-radius:12px;
  padding:22px;
  border:1px solid #e2e8f0;
}

.flow{
  text-align:center;
  margin:50px 0;
  font-weight:bold;
}

.cta{
  text-align:center;
  margin-top:50px;
}

.cta a{
  background:#1069cf;
  color:#fff;
  padding:14px 28px;
  border-radius:8px;
  text-decoration:none;
  font-weight:bold;
}
</style>
</head>

<body>

<div class="wrap">

<div class="hero">
<h1>AXIS</h1>
<p>Equipment Lifecycle Execution Engine</p>
</div>

<div class="steps">
<div class="step">
<h2>Identify</h2>
<p>Highlights equipment requiring attention based on timing and condition.</p>
</div>

<div class="step">
<h2>Decide</h2>
<p>Choose trade-in or execution at the right moment.</p>
</div>

<div class="step">
<h2>Execute</h2>
<p>Projects handled with full coordination and control.</p>
</div>
</div>

<div class="flow">
AXIS → Trade-In → Connect → Execution Complete
</div>

<div class="cta">
<a href="https://espinmedical.com/services">Explore Services</a>
</div>

</div>

</body>
</html>