attribute float base_angle;
		attribute float offsetX;
		attribute float offsetZ;
		
		uniform vec3 stretch;
		uniform float time;

		varying vec4 vUv;
		varying vec2 offset;
		void main() 
		{
		    vec3 p = position;
		   	offset = vec2(offsetX, offsetZ);
	        p.x = (stretch.x + offsetX)*cos( base_angle + time );
	        p.z = (stretch.z + offsetZ)*sin( base_angle + time );
	        p.y += (stretch.y + offsetX/10.0)*cos( base_angle + time );
		    
			gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
		    
		    vUv = projectionMatrix * vec4(p, 1.0);
		    gl_PointSize = 1.0;
		}
